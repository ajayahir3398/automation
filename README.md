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
```

### Build Configuration
- **Build Command**: `npm install`
- **Start Command**: `node index.js`
- **Environment**: Node

### Troubleshooting Chrome Executable Issues

If you encounter the error:
```
Tried to find the browser at the configured path (/tmp/puppeteer-cache/chrome/linux-137.0.7151.55/chrome-linux64/chrome), but no executable was found.
```

#### Solution 1: Clear Cache and Rebuild
1. In your Render dashboard, go to your service
2. Click "Manual Deploy" → "Clear build cache & deploy"
3. This will force Puppeteer to download a fresh copy of Chrome

#### Solution 2: Update Environment Variables
Make sure these are set in your Render environment:
- `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false`
- `PUPPETEER_EXECUTABLE_PATH=` (leave empty)

#### Solution 3: Check Build Logs
1. Go to your service in Render dashboard
2. Check the build logs for any Puppeteer download errors
3. If Chrome download fails, try redeploying

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Test Puppeteer setup:
```bash
npm run test-puppeteer
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
- `render.yaml` - Render deployment configuration

### Common Issues

1. **Chrome executable not found**: Clear build cache and redeploy
2. **Memory issues**: The app uses significant memory for browser automation
3. **Timeout issues**: Increase timeout values in the constants if needed

### Support

If you continue to have issues with Chrome executable on Render:
1. Check the Render logs for detailed error messages
2. Try the test script: `npm run test-puppeteer`
3. Consider using a different cloud platform that better supports Puppeteer 