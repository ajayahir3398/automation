const puppeteer = require('puppeteer');

// Puppeteer configuration for Render deployment
function getPuppeteerConfig() {
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
        console.log('Running on Render - configuring Chrome for cloud environment');
        
        // Clear any cached executable path
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
        
        // Force Puppeteer to download its own Chrome
        process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'false';
        
        // Add additional args for cloud environment
        launchOptions.args.push('--disable-dev-shm-usage');
        launchOptions.args.push('--disable-ipc-flooding-protection');
    }

    return launchOptions;
}

// Launch browser with error handling
async function launchBrowser() {
    const launchOptions = getPuppeteerConfig();
    
    console.log('Launching browser with options:', JSON.stringify(launchOptions, null, 2));
    
    try {
        const browser = await puppeteer.launch(launchOptions);
        console.log('Browser launched successfully');
        return browser;
    } catch (launchError) {
        console.error('Initial launch failed:', launchError.message);
        
        // Fallback: try without executable path
        console.log('Trying fallback launch without executable path...');
        const fallbackOptions = { ...launchOptions };
        delete fallbackOptions.executablePath;
        
        const browser = await puppeteer.launch(fallbackOptions);
        console.log('Browser launched successfully with fallback options');
        return browser;
    }
}

module.exports = {
    getPuppeteerConfig,
    launchBrowser
}; 