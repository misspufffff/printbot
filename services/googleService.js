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

  // Fetch printers from the projects sheet
  async getPrinters() {
    try {
      await this.initializeAuth()
      
      const range = 'Project Tracker!B:B' // Printer names in column B of Project Tracker tab
      const projectSheetId = process.env.PROJECT_SHEET || '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: projectSheetId,
        range
      })
      
      const printers = response.data.values
        ?.filter(row => row[0] && row[0].trim()) // Filter out empty rows
        ?.map(row => row[0].trim()) || []
      
      // If no printers found in sheet, return default options
      if (printers.length === 0) {
        return [
          'Printer 1 (Default)',
          'Printer 2 (High Quality)',
          'Printer 3 (Large Format)',
          'Printer 4 (Color)',
          'Printer 5 (Black & White)'
        ]
      }
      
      logger.info('Printers fetched successfully', { 
        count: printers.length,
        sheetId: projectSheetId,
        range: 'Project Tracker!B:B'
      })
      return printers
    } catch (error) {
      logger.error('Failed to fetch printers', { 
        error: error.message,
        sheetId: projectSheetId
      })
      // Return default printers if sheet access fails
      return [
        'Printer 1 (Default)',
        'Printer 2 (High Quality)',
        'Printer 3 (Large Format)',
        'Printer 4 (Color)',
        'Printer 5 (Black & White)'
      ]
    }
  }

  // Fetch materials from the projects sheet
  async getMaterials() {
    try {
      await this.initializeAuth()
      
      const range = 'Project Tracker!C:C' // Material names in column C of Project Tracker tab
      const projectSheetId = process.env.PROJECT_SHEET || '1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0'
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: projectSheetId,
        range
      })
      
      const materials = response.data.values
        ?.filter(row => row[0] && row[0].trim()) // Filter out empty rows
        ?.map(row => row[0].trim()) || []
      
      // If no materials found in sheet, return default options
      if (materials.length === 0) {
        return [
          'PLA (Standard)',
          'PLA+ (Enhanced)',
          'PETG (Durable)',
          'ABS (Heat Resistant)',
          'TPU (Flexible)',
          'Wood Fill',
          'Metal Fill',
          'Carbon Fiber'
        ]
      }
      
      logger.info('Materials fetched successfully', { 
        count: materials.length,
        sheetId: projectSheetId,
        range: 'Project Tracker!C:C'
      })
      return materials
    } catch (error) {
      logger.error('Failed to fetch materials', { 
        error: error.message,
        sheetId: projectSheetId
      })
      // Return default materials if sheet access fails
      return [
        'PLA (Standard)',
        'PLA+ (Enhanced)',
        'PETG (Durable)',
        'ABS (Heat Resistant)',
        'TPU (Flexible)',
        'Wood Fill',
        'Metal Fill',
        'Carbon Fiber'
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