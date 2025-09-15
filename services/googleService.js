import { google } from 'googleapis'
import fs from 'fs'
import { Readable } from 'stream'
import logger from '../utils/logger.js'

class GoogleService {
  constructor() {
    this.auth = null
    this.drive = null
    this.sheets = null
  }

  // Initialize Google authentication
  async initializeAuth() {
    if (this.auth) return this.auth

    // Try environment variable first (for Render deployment)
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
          ],
        })
        logger.info('Google authentication initialized from environment variable')
      } catch (error) {
        throw new Error(`Invalid GOOGLE_CREDENTIALS_JSON: ${error.message}`)
      }
    } else {
      // Fallback to file-based authentication (for local development)
      const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
      if (!keyFile) {
        throw new Error('Either GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS must be set')
      }
      
      if (!fs.existsSync(keyFile)) {
        throw new Error(`Service account key file not found at: ${keyFile}`)
      }

      this.auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      })
      logger.info('Google authentication initialized from file')
    }

    // Initialize API clients
    this.drive = google.drive({ version: 'v3', auth: this.auth })
    this.sheets = google.sheets({ version: 'v4', auth: this.auth })

    return this.auth
  }

  // Upload file to Google Drive
  async uploadToDrive(buffer, filename, mimeType) {
    try {
      await this.initializeAuth()
      
      const stream = Readable.from(buffer)
      const response = await this.drive.files.create({
        requestBody: {
          name: filename,
          parents: [process.env.DRIVE_FOLDER_ID],
        },
        media: { mimeType, body: stream },
        fields: 'id, webViewLink, webContentLink, name, size',
        supportsAllDrives: true,
      })

      logger.info('File uploaded to Drive', { 
        fileId: response.data.id, 
        filename,
        size: buffer.length 
      })
      
      return response.data
    } catch (error) {
      logger.error('Drive upload failed', { error: error.message, filename })
      throw new Error(`Drive upload failed: ${error.message}`)
    }
  }

  // Set up sheet headers if they don't exist
  async setupSheetHeaders() {
    try {
      await this.initializeAuth()
      
      const headers = ['Order', 'Timestamp', 'User', 'File Name', 'Project Name', 'Drive Link', 'Notes', 'Printer', 'Materials']
      const range = 'Submissions!A1:I1'
      
      // Check if headers already exist
      const existingHeaders = await this.sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range
      })
      
      if (existingHeaders.data.values && existingHeaders.data.values.length > 0) {
        logger.info('Sheet headers already exist, skipping setup')
        return
      }
      
      // Set up headers
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      })
      
      logger.info('Sheet headers set up successfully', { headers })
    } catch (error) {
      logger.error('Failed to set up sheet headers', { error: error.message })
      // Don't throw error - headers might already exist
    }
  }

  // Append data to Google Sheet
  async appendToSheet(values) {
    try {
      await this.initializeAuth()
      
      // Ensure headers are set up first
      await this.setupSheetHeaders()
      
      // Use proper range for appending data
      const range = 'Submissions!A:I' // Append to the entire column range
      const resource = { values: [values] }
      
      logger.info('Attempting to append to sheet', { 
        spreadsheetId: process.env.SHEET_ID,
        range,
        values 
      })
      
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range,
        valueInputOption: 'RAW', // Use RAW to prevent Google Sheets from auto-formatting
        requestBody: resource,
      })

      logger.info('Data appended to sheet successfully', { 
        updatedRange: response.data.updatedRange,
        updatedRows: response.data.updatedRows,
        values 
      })
      
      return response.data
    } catch (error) {
      logger.error('Sheet append failed', { 
        error: error.message, 
        values,
        spreadsheetId: process.env.SHEET_ID,
        range: 'Submissions!A:F'
      })
      throw new Error(`Sheet append failed: ${error.message}`)
    }
  }

  // Fetch projects from the projects sheet
  async getProjects() {
    try {
      await this.initializeAuth()
      
      const range = 'Project Tracker!A:A' // Project names in column A of Project Tracker tab
      const projectSheetId = process.env.PROJECT_SHEET || '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: projectSheetId,
        range
      })
      
      const projects = response.data.values
        ?.filter(row => row[0] && row[0].trim()) // Filter out empty rows
        ?.map(row => row[0].trim()) || []
      
      logger.info('Projects fetched successfully', { 
        count: projects.length,
        sheetId: projectSheetId,
        range: 'Project Tracker!A:A'
      })
      return projects
    } catch (error) {
      logger.error('Failed to fetch projects', { 
        error: error.message,
        sheetId: projectSheetId
      })
      return []
    }
  }

  // Get available printers
  async getPrinters() {
    try {
      // Return the specific 3D printers available
      const printers = [
        'Bambu',
        'Formlabs Form 3'
      ]
      
      logger.info('Printers loaded successfully', { 
        count: printers.length,
        printers
      })
      return printers
    } catch (error) {
      logger.error('Failed to load printers', { 
        error: error.message
      })
      // Return default printers if there's an error
      return [
        'Bambu',
        'Formlabs Form 3'
      ]
    }
  }

  // Get available materials based on printer
  async getMaterials(printer = null) {
    try {
      let materials = []
      
      if (printer === 'Bambu') {
        materials = [
          'PLA',
          'ABS',
          'ASA',
          'Other'
        ]
      } else if (printer === 'Formlabs Form 3') {
        materials = [
          'Tough 1500',
          'Tough 2000',
          'Durable',
          'White',
          'Clear',
          'Elastic 80A',
          'Other'
        ]
      } else {
        // Default materials for both printers
        materials = [
          'PLA',
          'ABS',
          'ASA',
          'Tough 1500',
          'Tough 2000',
          'Durable',
          'White',
          'Clear',
          'Elastic 80A',
          'Other'
        ]
      }
      
      logger.info('Materials loaded successfully', { 
        count: materials.length,
        materials,
        printer
      })
      return materials
    } catch (error) {
      logger.error('Failed to load materials', { 
        error: error.message
      })
      // Return default materials if there's an error
      return [
        'PLA',
        'ABS',
        'ASA',
        'Tough 1500',
        'Tough 2000',
        'Durable',
        'White',
        'Clear',
        'Elastic 80A',
        'Other'
      ]
    }
  }

  // Update a specific row with project selection
  async updateProjectSelection(rowIndex, projectName) {
    try {
      await this.initializeAuth()
      
      const range = `Submissions!E${rowIndex}` // Column E is Project Name
      const resource = { values: [[projectName]] }
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: resource
      })
      
      logger.info('Project selection updated', { rowIndex, projectName })
      return true
    } catch (error) {
      logger.error('Failed to update project selection', { 
        error: error.message, 
        rowIndex, 
        projectName 
      })
      return false
    }
  }

  // Test connection to Google services
  async testConnection() {
    try {
      await this.initializeAuth()
      
      // Test Drive access
      await this.drive.files.list({ pageSize: 1, supportsAllDrives: true })
      logger.info('Drive access test successful')
      
      // Test main submissions sheet access
      try {
        await this.sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID })
        logger.info('Main submissions sheet access test successful', { sheetId: process.env.SHEET_ID })
      } catch (error) {
        logger.error('Main submissions sheet not accessible', { 
          sheetId: process.env.SHEET_ID,
          error: error.message 
        })
        throw new Error(`Main submissions sheet not accessible: ${error.message}`)
      }
      
      // Test Projects sheet access
      try {
        const projectSheetId = process.env.PROJECT_SHEET || '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
        await this.sheets.spreadsheets.get({ spreadsheetId: projectSheetId })
        logger.info('Projects sheet access test successful', { sheetId: projectSheetId })
      } catch (error) {
        const projectSheetId = process.env.PROJECT_SHEET || '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
        logger.warn('Projects sheet not accessible - project dropdown will not work', { 
          sheetId: projectSheetId,
          error: error.message 
        })
        // Don't fail the entire connection test for projects sheet
      }
      
      logger.info('Google services connection test successful')
      return true
    } catch (error) {
      logger.error('Google services connection test failed', { 
        error: error.message,
        errorCode: error.code,
        errorStatus: error.status
      })
      return false
    }
  }
}

export default new GoogleService()