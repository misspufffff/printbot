import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

// Security middleware configuration
export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }),
  // Rate limiting for API endpoints
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  })
]

// File size validation
export const validateFileSize = (file, maxSize = 50 * 1024 * 1024) => {
  if (file.size && file.size > maxSize) {
    throw new Error(`File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`)
  }
  return true
}

// MIME type validation
export const validateMimeType = (mimetype, allowedTypes = []) => {
  if (allowedTypes.length === 0) {
    // Default allowed types
    allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  }
  
  if (!allowedTypes.includes(mimetype)) {
    throw new Error(`File type ${mimetype} is not allowed`)
  }
  return true
}

// Sanitize filename
export const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .substring(0, 255) // Limit length
}

// Validate Slack file ID format
export const validateSlackFileId = (fileId) => {
  const fileIdPattern = /^F[A-Z0-9]{8,}$/
  if (!fileIdPattern.test(fileId)) {
    throw new Error('Invalid Slack file ID format')
  }
  return true
}
