# Slack Print Bot

A secure, high-performance Slack bot that automatically uploads files to Google Drive and logs them in Google Sheets.

[![GitHub](https://img.shields.io/github/license/misspufffff/printbot)](https://github.com/misspufffff/printbot)
[![GitHub](https://img.shields.io/github/stars/misspufffff/printbot)](https://github.com/misspufffff/printbot)
[![GitHub](https://img.shields.io/github/issues/misspufffff/printbot)](https://github.com/misspufffff/printbot/issues)

## Features

- 🔒 **Security First**: Input validation, rate limiting, security headers
- ⚡ **High Performance**: Optimized file processing, parallel operations
- 📊 **Comprehensive Logging**: Winston-based logging with multiple levels
- 🛡️ **Error Handling**: Robust error handling and recovery
- 🔧 **Modular Architecture**: Clean separation of concerns
- 📝 **Environment Validation**: Joi-based configuration validation

## Quick Start

### Prerequisites

- Node.js 18+ 
- Slack App with Bot Token
- Google Cloud Project with Drive and Sheets APIs enabled
- Google Service Account with appropriate permissions

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Configure Google Service Account:**
   ```bash
   # Move your service account JSON to a secure location
   mkdir -p config/secrets
   mv service-account.json config/secrets/
   # Update GOOGLE_APPLICATION_CREDENTIALS in .env
   ```

4. **Start the bot:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) | ✅ |
| `SLACK_SIGNING_SECRET` | Slack app signing secret | ✅ |
| `SHEET_ID` | Google Sheets ID | ✅ |
| `DRIVE_FOLDER_ID` | Google Drive folder ID (in Shared Drive) | ✅ |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON | ✅ |
| `PORT` | Server port (default: 3000) | ❌ |
| `NODE_ENV` | Environment (development/production) | ❌ |
| `LOG_LEVEL` | Logging level (error/warn/info/debug) | ❌ |

### Google Cloud Setup

1. **Create a Google Cloud Project**
2. **Enable APIs:**
   - Google Drive API
   - Google Sheets API
3. **Create Service Account:**
   - Download JSON key file
   - Place in `config/secrets/` directory
4. **Set up Shared Drive:**
   - Create a Shared Drive in Google Drive
   - Create a folder inside the Shared Drive
   - Share the folder with your service account email
   - Use the folder ID as `DRIVE_FOLDER_ID`

### Slack App Setup

1. **Create Slack App** at https://api.slack.com/apps
2. **Configure OAuth & Permissions:**
   - Bot Token Scopes: `files:read`, `chat:write`, `users:read`
3. **Set up Slash Commands:**
   - Command: `/print`
   - Request URL: `https://your-domain.com/slack/events`
4. **Subscribe to Events:**
   - `file_shared`
5. **Install App** to your workspace

## Usage

### Slash Command

```
/print [file_id_or_url]
```

**Examples:**
- `/print` - Wait for file upload (2-minute window)
- `/print F1234567890` - Process specific Slack file
- `/print https://example.com/file.pdf` - Process file from URL

### File Processing Flow

1. **Download** file from Slack
2. **Upload** to Google Drive (Shared Drive)
3. **Log** details in Google Sheets
4. **Respond** with success message and Drive link

## Architecture

```
├── index.js                 # Main application entry point
├── config/
│   └── validation.js        # Environment validation schemas
├── services/
│   ├── googleService.js     # Google Drive & Sheets operations
│   └── slackService.js      # Slack API operations
├── utils/
│   ├── logger.js           # Winston logging configuration
│   └── security.js         # Security utilities & middleware
└── config/secrets/         # Service account credentials (gitignored)
```

## Security Features

- **Input Validation**: Joi schemas for all inputs
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Security Headers**: Helmet.js for security headers
- **File Validation**: Size limits, MIME type checking
- **Credential Protection**: Service account in secure location

## Performance Optimizations

- **Parallel Operations**: User info and permalink fetching
- **Connection Pooling**: Reused Google API clients
- **Memory Management**: Stream-based file processing
- **Caching**: In-memory waitlist with cleanup
- **Compression**: Gzip compression for responses

## Monitoring & Logging

### Log Levels
- `error`: Critical errors requiring attention
- `warn`: Warning conditions
- `info`: General information
- `debug`: Detailed debugging information

### Log Files
- `logs/combined.log`: All logs
- `logs/error.log`: Error logs only
- `logs/exceptions.log`: Uncaught exceptions
- `logs/rejections.log`: Unhandled promise rejections

### Health Checks
- `GET /` - Basic health check
- `GET /health` - Detailed health with service status

## Development

### Scripts
```bash
npm start          # Start production server
npm run dev        # Start with auto-reload
npm test           # Run tests (placeholder)
```

### Diagnostic Endpoints (Development Only)
- `GET /diag/sheets` - Test Google Sheets connection
- `GET /diag/drive` - Test Google Drive connection

## Error Handling

The bot includes comprehensive error handling:

- **Graceful Degradation**: Continues operation even if some services fail
- **User Feedback**: Clear error messages to users
- **Logging**: All errors logged with context
- **Recovery**: Automatic retry for transient failures

## Troubleshooting

### Common Issues

1. **"Google services connection test failed"**
   - Check service account JSON path
   - Verify APIs are enabled
   - Ensure service account has proper permissions

2. **"Slack download failed"**
   - Verify bot token is correct
   - Check file permissions in Slack

3. **"Sheet append failed"**
   - Verify sheet ID is correct
   - Check sheet has "Submissions" tab
   - Ensure service account has edit access

### Debug Mode

Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Links

- **Repository**: [https://github.com/misspufffff/printbot](https://github.com/misspufffff/printbot)
- **Issues**: [https://github.com/misspufffff/printbot/issues](https://github.com/misspufffff/printbot/issues)
- **Releases**: [https://github.com/misspufffff/printbot/releases](https://github.com/misspufffff/printbot/releases)

## License

MIT License - see [LICENSE](https://github.com/misspufffff/printbot/blob/main/LICENSE) file for details.
