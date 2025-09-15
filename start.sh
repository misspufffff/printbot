#!/bin/bash

# Set environment variables
export SHEET_ID="1c1IheYieGy6b3Z4Nuhhw88Et6CrSj41hQFphUYn4GqU"
export PROJECT_SHEET="1DhPrekXEd0GG45SpNftVbjKeHg52Jwec-_rQ9qX3Bz0"
export DRIVE_FOLDER_ID="your-drive-folder-id"
export SLACK_BOT_TOKEN="your-slack-bot-token"
export SLACK_SIGNING_SECRET="your-slack-signing-secret"
export GOOGLE_APPLICATION_CREDENTIALS="./config/secrets/service-account.json"
export PORT=3001

# Start the bot
npm start
