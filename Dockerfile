# Use official Playwright image with Node.js
FROM mcr.microsoft.com/playwright:v1.42.1

# Set working directory
WORKDIR /app

# Install latest npm version first
RUN npm install -g npm@11.4.2 --registry=https://registry.npmjs.org/

# Copy package files
COPY package*.json .

# Configure npm registry and install with retries
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --retry 10 --retry-delay 5

# Copy source files
COPY . .

# Install browsers
RUN npx playwright install chromium

# Cleanup npm cache
RUN npm cache clean --force

EXPOSE 3000
CMD ["npm", "start"]