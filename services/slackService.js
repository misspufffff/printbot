import fetch from 'node-fetch'
import logger from '../utils/logger.js'
import { validateSlackFileId, sanitizeFilename } from '../utils/security.js'

class SlackService {
  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN
  }

  // Download file from Slack
  async downloadFile(file) {
    try {
      const url = file.url_private_download || file.url_private || file.permalink
      if (!url) {
        throw new Error('No downloadable URL found in Slack file payload')
      }

      logger.info('Downloading file from Slack', { 
        filename: file.name, 
        url: url.substring(0, 50) + '...' 
      })

      const response = await fetch(url, {
        headers: { 
          Authorization: `Bearer ${this.botToken}` 
        }
      })

      if (!response.ok) {
        throw new Error(`Slack download failed: ${response.status} ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const data = Buffer.from(buffer)

      logger.info('File downloaded successfully', { 
        filename: file.name, 
        size: data.length 
      })

      return data
    } catch (error) {
      logger.error('Slack file download failed', { 
        error: error.message, 
        filename: file.name 
      })
      throw error
    }
  }

  // Get file information from Slack
  async getFileInfo(client, fileId) {
    try {
      validateSlackFileId(fileId)
      
      const response = await client.files.info({ file: fileId })
      return response.file
    } catch (error) {
      logger.error('Failed to get file info from Slack', { 
        error: error.message, 
        fileId 
      })
      throw error
    }
  }

  // Get user information from Slack
  async getUserInfo(client, userId) {
    try {
      const response = await client.users.info({ user: userId })
      return response.user
    } catch (error) {
      logger.warn('Failed to get user info from Slack', { 
        error: error.message, 
        userId 
      })
      return null
    }
  }

  // Get message permalink
  async getPermalink(client, channel, timestamp) {
    try {
      const response = await client.chat.getPermalink({ 
        channel, 
        message_ts: timestamp 
      })
      return response.permalink || ''
    } catch (error) {
      logger.warn('Failed to get permalink from Slack', { 
        error: error.message, 
        channel, 
        timestamp 
      })
      return ''
    }
  }

  // Process file from URL or file ID
  async processFileInput(client, input) {
    const trimmedInput = input.trim()
    
    if (trimmedInput.startsWith('F')) {
      // Slack file ID
      return await this.getFileInfo(client, trimmedInput)
    } else if (trimmedInput.startsWith('http')) {
      // Direct URL
      return {
        url_private_download: trimmedInput,
        name: sanitizeFilename(trimmedInput.split('/').pop() || 'file'),
        mimetype: 'application/octet-stream'
      }
    } else {
      throw new Error('Provide a Slack file ID (F123…) or a URL, or upload a file after /print.')
    }
  }

  // Get file permalink from various sources
  async getFilePermalink(client, file) {
    try {
      // Try direct permalink first
      if (file.permalink_public || file.permalink) {
        return file.permalink_public || file.permalink
      }

      // Try to get permalink from shares
      if (file.shares?.public) {
        const channel = Object.keys(file.shares.public)[0]
        const timestamp = file.shares.public[channel]?.[0]?.ts
        
        if (channel && timestamp) {
          return await this.getPermalink(client, channel, timestamp)
        }
      }

      return ''
    } catch (error) {
      logger.warn('Failed to get file permalink', { 
        error: error.message, 
        filename: file.name 
      })
      return ''
    }
  }
}

export default new SlackService()
