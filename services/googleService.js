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

  // Append data to Google Sheet
  async appendToSheet(values) {
    try {
      await this.initializeAuth()
      
      const range = 'Submissions!A:F'
      const resource = { values: [values] }
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: resource,
      })

      logger.info('Data appended to sheet', { values })
    } catch (error) {
      logger.error('Sheet append failed', { error: error.message, values })
      throw new Error(`Sheet append failed: ${error.message}`)
    }
  }

  // Test connection to Google services
  async testConnection() {
    try {
      await this.initializeAuth()
      
      // Test Drive access
      await this.drive.files.list({ pageSize: 1, supportsAllDrives: true })
      
      // Test Sheets access
      await this.sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID })
      
      logger.info('Google services connection test successful')
      return true
    } catch (error) {
      logger.error('Google services connection test failed', { error: error.message })
      return false
    }
  }
}

export default new GoogleService()