# DTE Works Automation

A Node.js application that automates tasks on dteworks.com using Puppeteer.

## Deployment on Render

### Prerequisites
- Node.js 18+ 
- Render account

### Environment Variables
Set these environment variables in your Render dashboard:

```
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
PUPPETEER_EXECUTABLE_PATH=
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
```

### Build Configuration
- **Build Command**: `npm install && npx puppeteer browsers install chrome`
- **Start Command**: `node index.js`
- **Environment**: Node

### Troubleshooting Chrome Installation Issues

If you encounter the error:
```
Could not find Chrome (ver. 137.0.7151.55). This can occur if either
1. you did not perform an installation before running the script (e.g. `npx puppeteer browsers install chrome`) or
2. your cache path is incorrectly configured (which is: /opt/render/.cache/puppeteer).
```

#### Solution 1: Update Build Command
Make sure your build command includes Chrome installation:
```
npm install && npx puppeteer browsers install chrome
```

#### Solution 2: Clear Cache and Rebuild
1. In your Render dashboard, go to your service
2. Click "Manual Deploy" → "Clear build cache & deploy"
3. This will force Puppeteer to download a fresh copy of Chrome

#### Solution 3: Check Environment Variables
Make sure these are set in your Render environment:
- `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false`
- `PUPPETEER_EXECUTABLE_PATH=` (leave empty)
- `PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer`

#### Solution 4: Test Chrome Installation
Run the test script to debug Chrome installation:
```bash
npm run test-chrome
```

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Install Chrome browser:
```bash
npx puppeteer browsers install chrome
```

3. Start the server:
```bash
npm start
```

4. Test Puppeteer setup:
```bash
npm run test-puppeteer
```

5. Test Chrome installation:
```bash
npm run test-chrome
```

### API Endpoints

- `GET /` - Login page
- `GET /health` - Health check
- `POST /login` - Start automation with phone number and password

### File Structure

- `index.js` - Main application file
- `login.html` - Login interface
- `puppeteer-config.js` - Puppeteer configuration for Render
- `render-setup.js` - Test script for Puppeteer setup
- `test-chrome.js` - Chrome installation test script
- `render.yaml` - Render deployment configuration

### Common Issues

1. **Chrome not found**: Run `npx puppeteer browsers install chrome` during build
2. **Cache path issues**: Set `PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer`
3. **Memory issues**: The app uses significant memory for browser automation
4. **Timeout issues**: Increase timeout values in the constants if needed

### Support

If you continue to have issues with Chrome installation on Render:
1. Check the Render build logs for Chrome installation errors
2. Run the test script: `npm run test-chrome`
3. Try the Puppeteer test: `npm run test-puppeteer`
4. Consider using a different cloud platform that better supports Puppeteer 