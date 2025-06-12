# Use official Node.js image with Playwright dependencies
FROM mcr.microsoft.com/playwright:v1.42.1

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Install browsers
RUN npx playwright install chromium

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]