import Joi from 'joi'

// Environment validation schema
export const envSchema = Joi.object({
  SLACK_BOT_TOKEN: Joi.string().pattern(/^xoxb-/).required(),
  SLACK_SIGNING_SECRET: Joi.string().min(1).required(),
  SHEET_ID: Joi.string().min(1).required(),
  DRIVE_FOLDER_ID: Joi.string().min(1).required(),
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().min(1).required(),
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('production'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info')
}).unknown(true) // Allow unknown environment variables

// File validation schema
export const fileSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  mimetype: Joi.string().min(1).max(100).required(),
  size: Joi.number().max(50 * 1024 * 1024).required(), // 50MB max
  url_private_download: Joi.string().uri().optional(),
  url_private: Joi.string().uri().optional(),
  permalink: Joi.string().uri().optional()
})

// Slack command validation
export const commandSchema = Joi.object({
  channel_id: Joi.string().min(1).required(),
  user_id: Joi.string().min(1).required(),
  text: Joi.string().max(1000).optional().allow('')
})
