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
const { error, value: env } = envSchema.validate(process.env)
if (error) {
  logger.error('Environment validation failed', { error: error.details })
  process.exit(1)
}

// Initialize Express receiver with security middleware
const receiver = new ExpressReceiver({
  signingSecret: env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
  processBeforeResponse: true
})

// Apply security middleware
receiver.router.use(compression())
receiver.router.use(...securityMiddleware)

// Initialize Slack app
const app = new App({
  token: env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true
})

// In-memory waitlist for /print without immediate file
const waiting = new Map()
const keyFor = (channel, user) => `${channel}:${user}`

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
      await googleService.appendToSheet(['', new Date().toISOString(), 'diag-user', 'diag-file', '', ''])
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

    // Otherwise wait 2 minutes for their next file in this channel
    const key = keyFor(channel_id, user_id)
    const expiresAt = Date.now() + 2 * 60 * 1000
    
    waiting.set(key, { expiresAt, respond })
    
    await respond({
      response_type: 'ephemeral',
      text: 'Okay — upload a file in this channel within the next 2 minutes and I\'ll send it to Drive + log it in Sheets.',
    })
    
    logger.info('User added to waitlist', { channel_id, user_id, expiresAt })
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
app.event('file_shared', async ({ event, client }) => {
  try {
    const fileId = event.file_id || event.file?.id
    if (!fileId) return

    logger.info('File shared event received', { fileId })

    const file = await slackService.getFileInfo(client, fileId)
    const channel = file.channels?.[0] || file.groups?.[0] || file.im?.[0]
    if (!channel) return

    const user = file.user || event.user_id
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

    // 4) Append to Google Sheet
    const sheetStartTime = Date.now()
    const driveLink = driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`
    
    await googleService.appendToSheet([
      '', // Order (auto via sheet)
      new Date().toISOString(), // Timestamp
      userName, // User
      file.name || 'unknown', // File Name
      permalink, // Slack Link
      driveLink // Drive Link
    ])
    
    logger.info('Data logged to sheet', { 
      sheetTime: Date.now() - sheetStartTime
    })

    // 5) Success response
    const totalTime = Date.now() - startTime
    await respond({
      response_type: 'ephemeral',
      text: `✅ Uploaded *${file.name}* to Drive and logged it in the sheet.\n• Drive: ${driveLink}\n• Processing time: ${totalTime}ms`,
    })

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

// Cleanup expired waitlist entries
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  
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
;(async () => {
  try {
    await app.start(port)
    logger.info(`🚀 Slack /print bot listening on port ${port}`)
    
    // Test Google services connection
    const googleHealthy = await googleService.testConnection()
    if (!googleHealthy) {
      logger.warn('Google services connection test failed - some features may not work')
    }
  } catch (error) {
    logger.error('Failed to start server', { error: error.message })
    process.exit(1)
  }
})()