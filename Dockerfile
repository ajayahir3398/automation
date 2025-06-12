# Use official Playwright image with Node.js
FROM mcr.microsoft.com/playwright:v1.42.1-focal

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

EXPOSE 3000
CMD ["npm", "start"]