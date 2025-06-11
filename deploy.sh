#!/bin/bash

# Deployment script for Render
echo "Setting up environment for Render deployment..."

# Set environment variables for Puppeteer
export NODE_ENV=production
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
export PUPPETEER_EXECUTABLE_PATH=""

# Clear any existing Puppeteer cache
echo "Clearing Puppeteer cache..."
rm -rf ~/.cache/puppeteer
rm -rf /tmp/puppeteer-cache

# Install dependencies
echo "Installing dependencies..."
npm install

# Test Puppeteer setup
echo "Testing Puppeteer setup..."
node render-setup.js

echo "Deployment setup complete!" 