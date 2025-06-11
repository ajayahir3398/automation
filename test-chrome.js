const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Chrome Installation Test ===');

// Check environment variables
console.log('\n1. Environment Variables:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD:', process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD);
console.log('PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
console.log('PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR);

// Check if we're on Render
const isRender = process.env.RENDER || process.env.RENDER_EXTERNAL_URL;
console.log('Running on Render:', !!isRender);

// Check cache directory
const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
console.log('\n2. Cache Directory Check:');
console.log('Cache directory:', cacheDir);

try {
    if (fs.existsSync(cacheDir)) {
        console.log('Cache directory exists');
        const files = fs.readdirSync(cacheDir);
        console.log('Files in cache:', files);
    } else {
        console.log('Cache directory does not exist');
    }
} catch (error) {
    console.log('Error checking cache directory:', error.message);
}

// Try to install Chrome
console.log('\n3. Installing Chrome...');
try {
    execSync('npx puppeteer browsers install chrome', { 
        stdio: 'inherit',
        env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
    });
    console.log('Chrome installation completed successfully');
} catch (error) {
    console.log('Chrome installation failed:', error.message);
}

// Check if Chrome is now available
console.log('\n4. Checking Chrome availability...');
try {
    const { execSync } = require('child_process');
    const result = execSync('npx puppeteer browsers list', { encoding: 'utf8' });
    console.log('Available browsers:');
    console.log(result);
} catch (error) {
    console.log('Error listing browsers:', error.message);
}

console.log('\n=== Test Complete ==='); 