// Optimized Slack Print Bot - Google Drive + Sheets Integration
// Features: Security, Performance, Error Handling, Logging, Modularity

import 'dotenv/config'
import bolt from '@slack/bolt'
const { App, ExpressReceiver } = bolt
import compression from 'compression'
import { securityMiddleware } from './utils/security.js'
import logger from './utils/logger.js'
import { envSchema } from './config/validation.js'
import googleService from './services/googleService.js'
import slackService from './services/slackService.js'

// Validate environment variables
console.log('🔍 Validating environment variables...')
const { error, value: env } = envSchema.validate(process.env)
if (error) {
  console.error('❌ Environment validation failed:')
  console.error(JSON.stringify(error.details, null, 2))
  console.error('\nRequired environment variables:')
  console.error('- SLACK_BOT_TOKEN (starts with xoxb-)')
  console.error('- SLACK_SIGNING_SECRET')
  console.error('- SHEET_ID')
  console.error('- DRIVE_FOLDER_ID')
  console.error('- GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS')
  process.exit(1)
}
console.log('✅ Environment validation passed')

// Initialize Express receiver with security middleware
const receiver = new ExpressReceiver({
  signingSecret: env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
  processBeforeResponse: true
})

// Apply security middleware
receiver.router.use(compression())
receiver.router.use(...securityMiddleware)

// Trust proxy for rate limiting (fixes X-Forwarded-For header error)
receiver.app.set('trust proxy', true)

// Initialize Slack app
const app = new App({
  token: env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true
})

// In-memory waitlist for /print without immediate file
const waiting = new Map()
const keyFor = (channel, user) => `${channel}:${user}`

// Show interactive print modal
async function showPrintModal({ client, channel_id, user_id, trigger_id }) {
  try {
    // Get projects and printers in parallel with timeout
    const [projects, printers] = await Promise.allSettled([
      Promise.race([
        googleService.getProjects(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Projects fetch timeout')), 10000))
      ]),
      Promise.race([
        googleService.getPrinters(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Printers fetch timeout')), 5000))
      ])
    ])

    // Get projects and create multiple dropdowns (100 items each)
    const allProjects = projects.status === 'fulfilled' ? projects.value : []
    
    // Create project dropdowns with 100 items each
    const projectDropdowns = []
    const itemsPerDropdown = 100
    
    for (let i = 0; i < allProjects.length; i += itemsPerDropdown) {
      const projectBatch = allProjects.slice(i, i + itemsPerDropdown)
      const dropdownNumber = Math.floor(i / itemsPerDropdown) + 1
      
      const projectOptions = projectBatch.map((project, index) => {
        // Ensure both display text and value are within Slack's character limit (using 65 for extra safety buffer)
        const maxLength = 65
        const truncatedProject = project.length > maxLength ? project.substring(0, maxLength - 3) + '...' : project
        const truncatedValue = project.length > maxLength ? project.substring(0, maxLength - 3) + '...' : project
        
        // Additional validation to ensure we don't exceed limits
        const finalText = truncatedProject.length > maxLength ? truncatedProject.substring(0, maxLength) : truncatedProject
        const finalValue = truncatedValue.length > maxLength ? truncatedValue.substring(0, maxLength) : truncatedValue
        
        // Debug logging for ALL projects in the 3rd dropdown (blocks/6)
        if (dropdownNumber === 3) {
          logger.info('Third dropdown project details', { 
            original: project, 
            finalText: finalText,
            finalValue: finalValue,
            textLength: finalText.length,
            valueLength: finalValue.length,
            optionIndex: index
          })
        }
        
        // Debug logging for long project names
        if (project.length > maxLength) {
          logger.info('Truncated long project name', { 
            original: project, 
            truncated: finalText,
            length: project.length,
            dropdownNumber,
            optionIndex: index
          })
        }
        
        return {
          text: { type: 'plain_text', text: finalText },
          value: finalValue
        }
      })
      
      const label = `Projects ${i + 1}-${Math.min(i + itemsPerDropdown, allProjects.length)}`
      projectDropdowns.push({
        label: label,
        options: projectOptions,
        blockId: `project_section_${dropdownNumber}`
      })
    }
    
    // Fallback if no projects
    if (projectDropdowns.length === 0) {
      projectDropdowns.push({
        label: 'No Projects',
        options: [{ text: { type: 'plain_text', text: 'No projects available' }, value: 'none' }],
        blockId: 'project_section_1'
      })
    }

    const printerOptions = printers.status === 'fulfilled' && printers.value.length > 0
      ? printers.value.map(printer => ({
          text: { type: 'plain_text', text: printer },
          value: printer
        }))
      : [{ text: { type: 'plain_text', text: 'No printers available' }, value: 'none' }]

    // Get default materials (will be updated dynamically based on printer selection)
    const defaultMaterials = await googleService.getMaterials()
    const materialOptions = defaultMaterials.length > 0
      ? defaultMaterials.map(material => ({
          text: { type: 'plain_text', text: material },
          value: material
        }))
      : [{ text: { type: 'plain_text', text: 'No materials available' }, value: 'none' }]

    // Validate trigger_id is still valid (Slack has a 3-second timeout)
    if (!trigger_id || Date.now() - parseInt(trigger_id.split('.')[0]) > 3000) {
      throw new Error('Trigger ID expired or invalid')
    }

    // Final validation: ensure no text field exceeds 75 characters
    const validateTextLength = (text, fieldName) => {
      if (text && text.length > 75) {
        logger.error(`Text field ${fieldName} exceeds 75 characters`, { 
          text, 
          length: text.length 
        })
        return text.substring(0, 72) + '...'
      }
      return text
    }

    // Validate all dropdown options and log details for debugging
    projectDropdowns.forEach((dropdown, dropdownIndex) => {
      logger.info(`Processing dropdown ${dropdownIndex + 1} with ${dropdown.options.length} options`)
      
      dropdown.options.forEach((option, optionIndex) => {
        const originalText = option.text.text
        const originalValue = option.value
        
        option.text.text = validateTextLength(option.text.text, `dropdown_${dropdownIndex}_option_${optionIndex}_text`)
        option.value = validateTextLength(option.value, `dropdown_${dropdownIndex}_option_${optionIndex}_value`)
        
        // Log details for the 3rd dropdown, 30th option (where error occurs)
        if (dropdownIndex === 2 && optionIndex === 29) {
          logger.error('PROBLEMATIC OPTION FOUND', {
            dropdownIndex: dropdownIndex + 1,
            optionIndex: optionIndex + 1,
            originalText,
            originalValue,
            finalText: option.text.text,
            finalValue: option.value,
            textLength: option.text.text.length,
            valueLength: option.value.length
          })
        }
        
        // Log any option that still exceeds limits
        if (option.text.text.length > 75 || option.value.length > 75) {
          logger.error('Option still exceeds limits after validation', {
            dropdownIndex: dropdownIndex + 1,
            optionIndex: optionIndex + 1,
            text: option.text.text,
            value: option.value,
            textLength: option.text.text.length,
            valueLength: option.value.length
          })
        }
      })
    })

    await client.views.open({
      trigger_id: trigger_id,
      view: {
        type: 'modal',
        callback_id: 'print_request_modal',
        title: {
          type: 'plain_text',
          text: 'Print Request'
        },
        submit: {
          type: 'plain_text',
          text: 'Submit Print Request'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Please fill out the print request form below:'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Select Project:*\n_All ${allProjects.length} projects organized in dropdowns below. Choose from any dropdown._`
            }
          },
          ...projectDropdowns.map((dropdown, index) => ({
            type: 'section',
            block_id: dropdown.blockId,
            text: {
              type: 'mrkdwn',
              text: `*${dropdown.label}:*`
            },
            accessory: {
              type: 'static_select',
              action_id: 'select_project',
              placeholder: {
                type: 'plain_text',
                text: `Choose from ${dropdown.label}...`.length > 75 ? 
                  `Choose from ${dropdown.label}...`.substring(0, 72) + '...' : 
                  `Choose from ${dropdown.label}...`
              },
              options: dropdown.options
            }
          })),
          {
            type: 'section',
            block_id: 'printer_section',
            text: {
              type: 'mrkdwn',
              text: '*Select Printer:*'
            },
            accessory: {
              type: 'static_select',
              action_id: 'select_printer',
              placeholder: {
                type: 'plain_text',
                text: 'Choose a printer...'
              },
              options: printerOptions
            }
          },
          {
            type: 'section',
            block_id: 'materials_section',
            text: {
              type: 'mrkdwn',
              text: '*Select Materials:*'
            },
            accessory: {
              type: 'static_select',
              action_id: 'select_materials',
              placeholder: {
                type: 'plain_text',
                text: 'Choose materials...'
              },
              options: materialOptions
            }
          },
          {
            type: 'input',
            block_id: 'other_material_section',
            element: {
              type: 'plain_text_input',
              action_id: 'other_material_input',
              placeholder: {
                type: 'plain_text',
                text: 'Enter custom material name...'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Custom Material (if "Other" selected):'
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'notes_section',
            element: {
              type: 'plain_text_input',
              action_id: 'add_notes',
              placeholder: {
                type: 'plain_text',
                text: 'Enter any notes about this print request...'
              },
              multiline: true
            },
            label: {
              type: 'plain_text',
              text: 'Add Notes:'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📁 File Upload:*\nAfter submitting this form, please upload your 3D model file directly in this channel. The bot will automatically process it and link it to your print request.'
            }
          }
        ]
      }
    })
  } catch (error) {
    logger.error('Failed to show print modal', { 
      error: error.message, 
      channel_id, 
      user_id 
    })
    throw error
  }
}

// Health check endpoints
receiver.router.get('/', (_req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    service: 'slack-print-bot',
    timestamp: new Date().toISOString()
  })
})

receiver.router.get('/health', async (_req, res) => {
  try {
    const googleHealthy = await googleService.testConnection()
    res.status(googleHealthy ? 200 : 503).json({
      status: googleHealthy ? 'healthy' : 'unhealthy',
      services: {
        google: googleHealthy ? 'connected' : 'disconnected'
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Health check failed', { error: error.message })
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Diagnostic endpoints (development only)
if (env.NODE_ENV === 'development') {
  receiver.router.get('/diag/sheets', async (_req, res) => {
    try {
      // Format timestamp as MM/DD/YYYY for diagnostic test
      const now = new Date()
      const timestamp = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`
      
      await googleService.appendToSheet(['', timestamp, 'diag-user', 'diag-file', '', ''])
      res.status(200).json({ status: 'success', message: 'Sheets append OK' })
    } catch (error) {
      logger.error('Sheets diagnostic failed', { error: error.message })
      res.status(500).json({ status: 'error', message: error.message })
    }
  })

  receiver.router.get('/diag/drive', async (_req, res) => {
    try {
      const file = await googleService.uploadToDrive(
        Buffer.from('hello'), 
        `diag-${Date.now()}.txt`, 
        'text/plain'
      )
      res.status(200).json({ status: 'success', fileId: file.id })
    } catch (error) {
      logger.error('Drive diagnostic failed', { error: error.message })
      res.status(500).json({ status: 'error', message: error.message })
    }
  })

  receiver.router.get('/diag/projects', async (_req, res) => {
    try {
      const projects = await googleService.getProjects()
      res.status(200).json({ 
        status: 'success', 
        projects,
        count: projects.length,
        sheetId: '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
      })
    } catch (error) {
      logger.error('Projects diagnostic failed', { error: error.message })
      res.status(500).json({ status: 'error', message: error.message })
    }
  })

  receiver.router.get('/diag/print-requests', async (_req, res) => {
    try {
      const pendingPrintRequests = global.pendingPrintRequests || new Map()
      const requests = Array.from(pendingPrintRequests.entries()).map(([id, request]) => ({
        id,
        ...request,
        submittedAt: new Date(request.submittedAt).toISOString(),
        completedAt: request.completedAt ? new Date(request.completedAt).toISOString() : null
      }))
      
      res.status(200).json({ 
        status: 'success', 
        requests,
        count: requests.length,
        pending: requests.filter(r => r.status === 'pending_file_upload').length,
        completed: requests.filter(r => r.status === 'completed').length
      })
    } catch (error) {
      logger.error('Print requests diagnostic failed', { error: error.message })
      res.status(500).json({ status: 'error', message: error.message })
    }
  })
}

// Slash command handler
app.command('/print', async ({ ack, payload, client, respond }) => {
  await ack()
  
  const { channel_id, user_id, text } = payload
  
  logger.info('Print command received', { 
    channel_id, 
    user_id, 
    hasText: !!text?.trim() 
  })

  try {
    // If user provided a file ID or URL, process immediately
    if (text && text.trim().length > 0) {
      await respond({ 
        response_type: 'ephemeral', 
        text: 'Processing your file…' 
      })
      
      const file = await slackService.processFileInput(client, text)
      await processFile({ client, file, channel_id, user_id, respond })
      return
    }

    // Show interactive modal for print request
    try {
      await showPrintModal({ client, channel_id, user_id, trigger_id: payload.trigger_id })
      logger.info('Print modal shown', { channel_id, user_id })
    } catch (modalError) {
      logger.error('Failed to show print modal', { 
        error: modalError.message, 
        channel_id, 
        user_id 
      })
      
      // Fallback: show a simple message with instructions
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ Could not load the print form. Please try again in a moment.\n\nIf the problem persists, you can:\n• Upload your file directly and I'll process it\n• Use \`/print <file_id>\` with a Slack file ID\n• Contact an administrator`
      })
      return
    }
  } catch (error) {
    logger.error('Print command failed', { 
      error: error.message, 
      channel_id, 
      user_id 
    })
    await respond({ 
      response_type: 'ephemeral', 
      text: `❌ Could not process that input: ${error.message}` 
    })
  }
})

// File shared event handler
app.event('file_shared', async ({ event, client, ack }) => {
  await ack()
  
  try {
    const fileId = event.file_id || event.file?.id
    if (!fileId) return

    logger.info('File shared event received', { fileId })

    const file = await slackService.getFileInfo(client, fileId)
    const channel = file.channels?.[0] || file.groups?.[0] || file.im?.[0]
    if (!channel) return

    const user = file.user || event.user_id
    
    // Check for pending print requests first
    const pendingPrintRequests = global.pendingPrintRequests || new Map()
    let printRequest = null
    let printRequestId = null
    
    for (const [id, request] of pendingPrintRequests.entries()) {
      if (request.user_id === user && request.status === 'pending_file_upload') {
        printRequest = request
        printRequestId = id
        break
      }
    }
    
    if (printRequest) {
      // Process print request with file
      await client.chat.postMessage({
        channel,
        text: 'Got it — processing your print request with the uploaded file…'
      })
      
      // Update status to completed instead of removing
      global.pendingPrintRequests.set(printRequestId, {
        ...printRequest,
        status: 'completed',
        completedAt: Date.now(),
        fileId: file.id,
        fileName: file.name
      })
      
      // Process the complete print request
      await processPrintRequest({
        client,
        file,
        user_id: user,
        project: printRequest.project,
        printer: printRequest.printer,
        materials: printRequest.materials,
        notes: printRequest.notes
      })
      return
    }
    
    // Fallback to old file upload logic
    const key = keyFor(channel, user)
    const wait = waiting.get(key)
    
    if (!wait) return

    if (Date.now() > wait.expiresAt) {
      waiting.delete(key)
      await client.chat.postEphemeral({ 
        channel, 
        user, 
        text: 'Sorry, the 2-minute window expired. Use /print again.' 
      })
      return
    }

    await wait.respond({ 
      response_type: 'ephemeral', 
      text: 'Got it — sending your file now…' 
    })
    waiting.delete(key)

    const respondShim = (msg) =>
      client.chat.postEphemeral({ 
        channel, 
        user, 
        text: typeof msg === 'string' ? msg : msg.text 
      })

    await processFile({ 
      client, 
      file, 
      channel_id: channel, 
      user_id: user, 
      respond: respondShim 
    })
  } catch (error) {
    logger.error('File shared event handler failed', { 
      error: error.message, 
      fileId: event.file_id 
    })
  }
})

// Handle project selection (for form updates)
app.action('select_project', async ({ ack, body, client, respond }) => {
  await ack()
  // This is handled by the form submission, no immediate response needed
})

// Handle printer selection (for dynamic materials update)
app.action('select_printer', async ({ ack, body, client, respond }) => {
  await ack()
  
  try {
    const selectedPrinter = body.actions[0].selected_option?.value
    if (!selectedPrinter || selectedPrinter === 'none') return
    
    // Get materials for the selected printer
    const materials = await googleService.getMaterials(selectedPrinter)
    const materialOptions = materials.map(material => ({
      text: { type: 'plain_text', text: material },
      value: material
    }))
    
    // Update the materials dropdown
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'print_request_modal',
        title: {
          type: 'plain_text',
          text: 'Print Request'
        },
        submit: {
          type: 'plain_text',
          text: 'Submit Print Request'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: body.view.blocks.map(block => {
          if (block.block_id === 'materials_section') {
            return {
              ...block,
              accessory: {
                ...block.accessory,
                options: materialOptions
              }
            }
          }
          return block
        })
      }
    })
  } catch (error) {
    logger.error('Failed to update materials for printer', { 
      error: error.message,
      printer: body.actions[0].selected_option?.value
    })
  }
})

// Handle notes input (for form updates)
app.action('add_notes', async ({ ack, body, client, respond }) => {
  await ack()
  // This is handled by the form submission, no immediate response needed
})

// Handle form submission
app.action('submit_file_log', async ({ ack, body, client, respond }) => {
  await ack()
  
  try {
    const fileId = body.actions[0].value
    const fileData = global.pendingFiles?.get(fileId)
    
    if (!fileData) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ File data expired. Please upload the file again.'
      })
      return
    }
    
    // Get form values from the view state
    const projectSelection = body.view?.state?.values?.project_section?.select_project?.selected_option?.value
    const notes = body.view?.state?.values?.notes_section?.add_notes?.value || ''
    
    if (!projectSelection) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please select a project before submitting.'
      })
      return
    }
    
    logger.info('File log submission received', { 
      fileId,
      project: projectSelection,
      hasNotes: !!notes,
      user: body.user.id 
    })
    
    // Format timestamp as MM/DD/YYYY
    const now = new Date()
    const timestamp = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`
    
    // Append to sheet
    const sheetResponse = await googleService.appendToSheet([
      '', // Order (auto via sheet)
      timestamp, // Timestamp (MM/DD/YYYY)
      fileData.userName, // User
      fileData.file.name || 'unknown', // File Name
      projectSelection, // Project Name
      fileData.driveFile.webViewLink || `https://drive.google.com/file/d/${fileData.driveFile.id}/view`, // Drive Link
      notes // Notes
    ])
    
    // Clean up stored data
    global.pendingFiles?.delete(fileId)
    
    await respond({
      response_type: 'ephemeral',
      text: `✅ File logged successfully!\n• Project: *${projectSelection}*\n• Notes: ${notes || 'None'}\n• Drive: ${fileData.driveFile.webViewLink || `https://drive.google.com/file/d/${fileData.driveFile.id}/view`}`
    })
    
  } catch (error) {
    logger.error('File log submission failed', { 
      error: error.message, 
      user: body.user.id 
    })
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error logging file: ${error.message}`
    })
  }
})

// Handle form cancellation
app.action('cancel_file_log', async ({ ack, body, client, respond }) => {
  await ack()
  
  try {
    const fileId = body.actions[0].value
    global.pendingFiles?.delete(fileId)
    
    await respond({
      response_type: 'ephemeral',
      text: '❌ File logging cancelled.'
    })
  } catch (error) {
    logger.error('File log cancellation failed', { 
      error: error.message, 
      user: body.user.id 
    })
  }
})

// Handle print request modal submission
app.view('print_request_modal', async ({ ack, body, client, view }) => {
  await ack()
  
  try {
    const values = view.state.values
    const user_id = body.user.id
    
    // Extract form values - check all project sections
    let project = null
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('project_section_') && value?.select_project?.selected_option?.value) {
        project = value.select_project.selected_option.value
        break
      }
    }
    
    const printer = values.printer_section?.select_printer?.selected_option?.value
    const materials = values.materials_section?.select_materials?.selected_option?.value
    const customMaterial = values.other_material_section?.other_material_input?.value || ''
    const notes = values.notes_section?.add_notes?.value || ''
    
    // Use custom material if "Other" is selected and custom material is provided
    const finalMaterial = materials === 'Other' && customMaterial.trim() 
      ? customMaterial.trim() 
      : materials
    
    logger.info('Print request modal submitted', { 
      user_id,
      project,
      printer,
      materials: finalMaterial,
      customMaterial,
      hasNotes: !!notes
    })
    
    // Validate required fields
    if (!project || project === 'none') {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Please select a project before submitting.'
      })
      return
    }
    
    if (!printer || printer === 'none') {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Please select a printer before submitting.'
      })
      return
    }
    
    if (!finalMaterial || finalMaterial === 'none') {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Please select materials before submitting.'
      })
      return
    }
    
    if (materials === 'Other' && !customMaterial.trim()) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Please specify the custom material name when "Other" is selected.'
      })
      return
    }
    
    if (!notes || notes.trim().length === 0) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Please add notes before submitting.'
      })
      return
    }
    
    // Store the print request details for file upload
    const printRequestId = `print_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const printRequest = {
      user_id,
      project,
      printer,
      materials: finalMaterial,
      notes,
      submittedAt: Date.now(),
      status: 'pending_file_upload'
    }
    
    // Store in global pending requests (no expiration)
    global.pendingPrintRequests = global.pendingPrintRequests || new Map()
    global.pendingPrintRequests.set(printRequestId, printRequest)
    
    // Send confirmation message in channel
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Print request submitted!\n\n*Details:*\n• Project: *${project}*\n• Printer: *${printer}*\n• Materials: *${finalMaterial}*\n• Notes: ${notes}\n\n📁 **Please upload your 3D model file in this channel to complete your print request.**`
    })
    
  } catch (error) {
    logger.error('Print request modal submission failed', { 
      error: error.message, 
      user: body.user.id 
    })
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Error processing print request: ${error.message}`
    })
  }
})

// Process print request with all form data
async function processPrintRequest({ client, file, user_id, project, printer, materials, notes }) {
  const startTime = Date.now()
  
  try {
    // 1) Download from Slack
    logger.info('Starting print request processing', { 
      filename: file.name, 
      mimetype: file.mimetype,
      user_id,
      project,
      printer,
      materials
    })
    
    const data = await slackService.downloadFile(file)
    logger.info('File downloaded for print request', { 
      filename: file.name, 
      size: data.length,
      downloadTime: Date.now() - startTime
    })

    // 2) Upload to Google Drive
    const driveStartTime = Date.now()
    const driveFile = await googleService.uploadToDrive(
      data, 
      file.name || `upload-${Date.now()}`, 
      file.mimetype || 'application/octet-stream'
    )
    logger.info('File uploaded to Drive for print request', { 
      fileId: driveFile.id, 
      uploadTime: Date.now() - driveStartTime
    })

    // 3) Get user info
    const userInfo = await slackService.getUserInfo(client, user_id)
    const userName = userInfo?.real_name || userInfo?.name || user_id

    // 4) Log to sheet with all print request data
    const now = new Date()
    const timestamp = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`
    
    const sheetResponse = await googleService.appendToSheet([
      '', // Order (auto via sheet)
      timestamp, // Timestamp (MM/DD/YYYY)
      userName, // User
      file.name || 'unknown', // File Name
      project, // Project Name
      driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`, // Drive Link
      notes, // Notes
      printer, // Printer
      materials // Materials
    ])
    
    const totalTime = Date.now() - startTime
    
    logger.info('Print request processing completed successfully', {
      filename: file.name,
      totalTime,
      user_id,
      project,
      printer,
      materials
    })

    // 5) Send success response in channel
    await client.chat.postMessage({
      channel: user_id,
      text: `✅ Print request submitted successfully!\n\n*Details:*\n• Project: *${project}*\n• Printer: *${printer}*\n• Materials: *${materials}*\n• File: *${file.name}*\n• Drive: ${driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`}\n• Notes: ${notes}\n• Processing time: ${totalTime}ms`
    })

  } catch (error) {
    logger.error('Print request processing failed', {
      error: error.message,
      filename: file.name,
      user_id,
      project,
      printer,
      materials,
      processingTime: Date.now() - startTime
    })

    await client.chat.postMessage({
      channel: user_id,
      text: `❌ Print request failed: ${error.message}`,
    })
  }
}

// Core file processing function
async function processFile({ client, file, channel_id, user_id, respond }) {
  const startTime = Date.now()
  
  try {
    // 1) Download from Slack
    logger.info('Starting file processing', { 
      filename: file.name, 
      mimetype: file.mimetype,
      channel_id,
      user_id
    })
    
    const data = await slackService.downloadFile(file)
    logger.info('File downloaded', { 
      filename: file.name, 
      size: data.length,
      downloadTime: Date.now() - startTime
    })

    // 2) Upload to Google Drive
    const driveStartTime = Date.now()
    const driveFile = await googleService.uploadToDrive(
      data, 
      file.name || `upload-${Date.now()}`, 
      file.mimetype || 'application/octet-stream'
    )
    logger.info('File uploaded to Drive', { 
      fileId: driveFile.id, 
      uploadTime: Date.now() - driveStartTime
    })

    // 3) Get user info and permalink (parallel)
    const [userInfo, slackPermalink] = await Promise.allSettled([
      slackService.getUserInfo(client, user_id),
      slackService.getFilePermalink(client, file)
    ])

    const userName = userInfo.status === 'fulfilled' 
      ? (userInfo.value?.real_name || userInfo.value?.name || user_id)
      : user_id

    const permalink = slackPermalink.status === 'fulfilled' 
      ? slackPermalink.value 
      : ''

    // 4) Get projects for interactive prompt
    const totalTime = Date.now() - startTime
    
    logger.info('Attempting to fetch projects for interactive prompt', { 
      sheetId: '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
    })
    
    const projects = await googleService.getProjects()
    
    logger.info('Projects fetched for interactive prompt', { 
      count: projects.length,
      projects: projects.slice(0, 5) // Log first 5 projects for debugging
    })
    
    if (projects.length > 0) {
      // Create project selection dropdown
      const projectOptions = projects.map(project => ({
        text: {
          type: 'plain_text',
          text: project
        },
        value: project
      }))
      
      // Store file info for later processing
      const fileData = {
        file,
        driveFile,
        userName,
        channel_id,
        user_id,
        startTime
      }
      
      // Store the file data temporarily (you might want to use a database in production)
      global.pendingFiles = global.pendingFiles || new Map()
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      global.pendingFiles.set(fileId, fileData)
      
      // Set expiration (5 minutes)
      setTimeout(() => {
        global.pendingFiles?.delete(fileId)
      }, 5 * 60 * 1000)
      
      await respond({
        response_type: 'ephemeral',
        text: `✅ Uploaded *${file.name}* to Drive!\n• Drive: ${driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`}\n• Processing time: ${totalTime}ms\n\nPlease complete the form below to log this file:`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Uploaded *${file.name}* to Drive!\n• Drive: ${driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`}\n• Processing time: ${totalTime}ms\n\nPlease complete the form below to log this file:`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            block_id: 'project_section',
            text: {
              type: 'mrkdwn',
              text: '*Select Project:*'
            },
            accessory: {
              type: 'static_select',
              action_id: 'select_project',
              placeholder: {
                type: 'plain_text',
                text: 'Choose a project...'
              },
              options: projectOptions
            }
          },
          {
            type: 'input',
            block_id: 'notes_section',
            element: {
              type: 'plain_text_input',
              action_id: 'add_notes',
              placeholder: {
                type: 'plain_text',
                text: 'Enter any notes about this file...'
              },
              multiline: true
            },
            label: {
              type: 'plain_text',
              text: 'Add Notes (optional):'
            },
            optional: true
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Submit to Log'
                },
                style: 'primary',
                action_id: 'submit_file_log',
                value: fileId
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Cancel'
                },
                action_id: 'cancel_file_log',
                value: fileId
              }
            ]
          }
        ]
      })
    } else {
      // Fallback if no projects
      await respond({
        response_type: 'ephemeral',
        text: `✅ Uploaded *${file.name}* to Drive!\n• Drive: ${driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`}\n• Processing time: ${totalTime}ms\n\n⚠️ Could not load project list. Please update the project manually in the sheet.`,
      })
    }

    logger.info('File processing completed successfully', {
      filename: file.name,
      totalTime,
      channel_id,
      user_id
    })

  } catch (error) {
    logger.error('File processing failed', {
      error: error.message,
      filename: file.name,
      channel_id,
      user_id,
      processingTime: Date.now() - startTime
    })

    await respond({
      response_type: 'ephemeral',
      text: `❌ Processing failed: ${error.message}`,
    })
  }
}

// Cleanup expired waitlist entries (print requests are kept permanently)
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  
  // Clean up expired waitlist entries
  for (const [key, value] of waiting.entries()) {
    if (value.expiresAt < now) {
      waiting.delete(key)
      cleaned++
    }
  }
  
  if (cleaned > 0) {
    logger.debug('Cleaned expired waitlist entries', { count: cleaned })
  }
}, 60 * 1000) // Run every minute

// Error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise })
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  process.exit(0)
})

// Start server
const port = env.PORT
console.log(`🚀 Starting server on port ${port}...`)
;(async () => {
  try {
    console.log('🔧 Initializing Slack app...')
    await app.start(port)
    console.log(`✅ Slack /print bot listening on port ${port}`)
    logger.info(`🚀 Slack /print bot listening on port ${port}`)
    
    console.log('🔍 Testing Google services connection...')
    // Test Google services connection
    const googleHealthy = await googleService.testConnection()
    if (!googleHealthy) {
      console.warn('⚠️ Google services connection test failed - some features may not work')
      logger.warn('Google services connection test failed - some features may not work')
    } else {
      console.log('✅ Google services connection successful')
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error.message)
    console.error('Stack trace:', error.stack)
    logger.error('Failed to start server', { error: error.message })
    process.exit(1)
  }
})()