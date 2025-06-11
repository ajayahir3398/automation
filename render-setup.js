const puppeteer = require('puppeteer');

// Test function to check Puppeteer setup on Render
async function testPuppeteerSetup() {
    console.log('Testing Puppeteer setup...');
    console.log('Environment variables:');
    console.log('RENDER:', process.env.RENDER);
    console.log('RENDER_EXTERNAL_URL:', process.env.RENDER_EXTERNAL_URL);
    console.log('CHROME_BIN:', process.env.CHROME_BIN);
    console.log('PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR);
    
    const isRender = process.env.RENDER || process.env.RENDER_EXTERNAL_URL;
    
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ],
        ignoreDefaultArgs: ['--disable-extensions']
    };

    if (isRender) {
        console.log('Running on Render - using automatic Chrome installation');
        launchOptions.args.push('--disable-dev-shm-usage');
    }

    try {
        console.log('Launching browser...');
        const browser = await puppeteer.launch(launchOptions);
        console.log('Browser launched successfully!');
        
        const page = await browser.newPage();
        console.log('Page created successfully!');
        
        await page.goto('https://www.google.com');
        console.log('Successfully navigated to Google!');
        
        await browser.close();
        console.log('Browser closed successfully!');
        
        return { success: true, message: 'Puppeteer setup test passed!' };
    } catch (error) {
        console.error('Puppeteer setup test failed:', error.message);
        return { success: false, message: error.message };
    }
}

// Export for use in other files
module.exports = { testPuppeteerSetup };

// Run test if this file is executed directly
if (require.main === module) {
    testPuppeteerSetup().then(result => {
        console.log('Test result:', result);
        process.exit(result.success ? 0 : 1);
    });
} 