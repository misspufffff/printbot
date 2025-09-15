#!/bin/bash

# Slack Print Bot Setup Script
# This script helps set up the environment for the Slack Print Bot

set -e

echo "🚀 Setting up Slack Print Bot..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your actual configuration values"
else
    echo "✅ .env file already exists"
fi

# Check if service account is in secure location
if [ -f "config/secrets/service-account.json" ]; then
    echo "✅ Service account is in secure location"
else
    echo "⚠️  Please move your service-account.json to config/secrets/"
    echo "   and update GOOGLE_APPLICATION_CREDENTIALS in .env"
fi

# Set proper permissions
chmod 600 config/secrets/*.json 2>/dev/null || true
chmod 755 scripts/setup.sh

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Ensure service-account.json is in config/secrets/"
echo "3. Run 'npm start' to start the bot"
echo ""
echo "For development, use 'npm run dev' for auto-reload"
