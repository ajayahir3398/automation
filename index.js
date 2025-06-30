const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

// Session management - Store by phone number
const sessions = new Map(); // phoneNumber -> session
const sessionIds = new Map(); // sessionId -> phoneNumber (for reverse lookup)

// Parallel session management
const MAX_CONCURRENT_SESSIONS = 3; // Limit concurrent sessions
const SESSION_QUEUE = []; // Queue for pending sessions
let activeSessionCount = 0;
let activeSessions = new Set(); // Track active session IDs to prevent double counting

class AutomationSession {
    constructor(phoneNumber) {
        this.id = Date.now().toString();
        this.logs = [];
        this.isRunning = false;
        this.browser = null;
        this.phoneNumber = phoneNumber;
        this.startTime = null;
        this.retryCount = 0;
        this.maxRetries = 2;
        this.isActiveSession = false; // Track if this session is counted in activeSessionCount
    }

    log(message) {
        let emoji = '📝'; // default emoji

        // Add emojis based on message content
        if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
            emoji = '❌';
        } else if (message.toLowerCase().includes('phone')) {
            emoji = '📱';
        } else if (message.toLowerCase().includes('password')) {
            emoji = '🔒';
        } else if (message.toLowerCase().includes('success') || message.toLowerCase().includes('completed')) {
            emoji = '✅';
        } else if (message.toLowerCase().includes('start') || message.toLowerCase().includes('begin')) {
            emoji = '🚀';
        } else if (message.toLowerCase().includes('stop') || message.toLowerCase().includes('end')) {
            emoji = '🛑';
        } else if (message.toLowerCase().includes('wait') || message.toLowerCase().includes('loading')) {
            emoji = '⏳';
        } else if (message.toLowerCase().includes('login')) {
            emoji = '🔑';
        } else if (message.toLowerCase().includes('navigate') || message.toLowerCase().includes('page')) {
            emoji = '🌐';
        } else if (message.toLowerCase().includes('click')) {
            emoji = '👆';
        } else if (message.toLowerCase().includes('type') || message.toLowerCase().includes('enter')) {
            emoji = '⌨️';
        } else if (message.toLowerCase().includes('screenshot')) {
            emoji = '📸';
        } else if (message.toLowerCase().includes('video') || message.toLowerCase().includes('play') || message.toLowerCase().includes('watch')) {
            emoji = '📺';
        } else if (message.toLowerCase().includes('task')) {
            emoji = '📋';
        } else if (message.toLowerCase().includes('answer')) {
            emoji = '✍️';
        }

        // Get current UTC time
        const now = new Date();
        // Convert to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
        const istTime = new Date(now.getTime() + istOffset);

        // Format the date components
        const day = istTime.getUTCDate().toString().padStart(2, '0');
        const month = (istTime.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = istTime.getUTCFullYear().toString().slice(-2);
        const hours = istTime.getUTCHours().toString().padStart(2, '0');
        const minutes = istTime.getUTCMinutes().toString().padStart(2, '0');
        const seconds = istTime.getUTCSeconds().toString().padStart(2, '0');
        const formattedTime = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
        console.log(message)
        this.logs.push(`${formattedTime} - ${emoji} ${message}`);
        if (this.logs.length > 1000) this.logs.shift(); // prevent memory overflow
    }

    async stop() {
        this.isRunning = false;
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
            } catch (error) {
                this.log(`Error closing browser: ${error.message}`);
            }
        }
        // Don't delete screenshots automatically - only when manually stopped
    }

    async stopAndCleanup() {
        this.isRunning = false;
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
            } catch (error) {
                this.log(`Error closing browser: ${error.message}`);
            }
        }
        // Delete screenshots for this phone number only when manually stopped
        await deleteScreenshotsForPhone(this.phoneNumber);
    }
}

// Utility functions for session management
function getSessionByPhone(phoneNumber) {
    return sessions.get(phoneNumber);
}

function getSessionById(sessionId) {
    const phoneNumber = sessionIds.get(sessionId);
    return phoneNumber ? sessions.get(phoneNumber) : null;
}

function storeSession(session) {
    sessions.set(session.phoneNumber, session);
    sessionIds.set(session.id, session.phoneNumber);
}

function removeSession(session) {
    console.log(`Removing session for ${session.phoneNumber}, isRunning: ${session.isRunning}, isActiveSession: ${session.isActiveSession}, activeSessionCount: ${activeSessionCount}`);
    sessions.delete(session.phoneNumber);
    sessionIds.delete(session.id);

    // Only decrement if this session was actually counted as active
    if (session.isActiveSession) {
        activeSessions.delete(session.id);
        activeSessionCount = activeSessions.size;
        session.isActiveSession = false;
        console.log(`Session removed, activeSessionCount now: ${activeSessionCount}`);
        processNextSession();
    }
}

// Function to manually remove session (for stop button)
function removeSessionManually(session) {
    console.log(`Manually removing session for ${session.phoneNumber}, isActiveSession: ${session.isActiveSession}, activeSessionCount: ${activeSessionCount}`);
    sessions.delete(session.phoneNumber);
    sessionIds.delete(session.id);

    // Always decrement count for manual stops if it was an active session
    if (session.isActiveSession) {
        activeSessions.delete(session.id);
        activeSessionCount = activeSessions.size;
        session.isActiveSession = false;
        console.log(`Session manually removed, activeSessionCount now: ${activeSessionCount}`);
        processNextSession();
    }
}

// Function to mark session as active
function markSessionAsActive(session) {
    if (!session.isActiveSession) {
        session.isActiveSession = true;
        activeSessions.add(session.id);
        activeSessionCount = activeSessions.size;
        console.log(`Session ${session.id} marked as active, activeSessionCount: ${activeSessionCount}`);
    }
}


// Utility functions for screenshot management
async function deleteScreenshotsForPhone(phoneNumber) {
    try {
        const screenshotsDir = path.join(__dirname, 'screenshots', phoneNumber);
        if (fs.existsSync(screenshotsDir)) {
            const files = fs.readdirSync(screenshotsDir);
            for (const file of files) {
                const filePath = path.join(screenshotsDir, file);
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                }
            }
            fs.rmdirSync(screenshotsDir);
            console.log(`Deleted screenshots for phone: ${phoneNumber}`);
        }
    } catch (error) {
        console.error(`Error deleting screenshots for phone ${phoneNumber}:`, error);
    }
}

// Constants
const CONSTANTS = {
    WAIT_TIMES: {
        PAGE_LOAD: 2000,
        ANSWER_BEFORE_SUBMIT: 2000,
        ANSWER_AFTER_SUBMIT: 2000,
    },
    SELECTORS: {
        LOGIN: {
            PHONE: 'input[type="tel"][placeholder="Please enter your phone number"]',
            PASSWORD: 'input[type="password"][placeholder="Please enter login password"]',
            SUBMIT: 'button.van-button--danger'
        },
        TASK: {
            TABBAR: '.van-tabbar',
            TASK_LIST: 'div[data-v-02e24912][role="feed"].van-list',
            TASK_ITEM: 'div[data-v-02e24912].div',
            VIDEO: 'div[data-v-1d18d737].taskVideo',
            PLAY_BUTTON: '.vjs-big-play-button',
            ANSWER: 'div[data-v-1d18d737].answer',
            START_ANSWERING: 'button.van-button--danger .van-button__text',
            SUBMIT_ANSWER: 'button.van-button--danger'
        }
    },
    URLS: {
        LOGIN: 'https://dteworks.com/xml/index.html#/login'
    },
    SCREENSHOTS: {
        LOGGED_IN: 'screenshots/loggedin.png',
        TASK_TAB: 'screenshots/tasktab.png',
        TASK_DETAILS: 'screenshots/taskdetails.png',
        VIDEO_PLAYING: 'screenshots/videoPlaying.png',
        ANSWER_OPTIONS: 'screenshots/answerOptions.png',
        AFTER_SUBMIT: 'screenshots/afterSubmit.png',
        AFTER_BACK: 'screenshots/afterBack.png',
        GO_BACK: 'screenshots/goBack.png'
    },
    VIDEO: {
        REQUIRED_SECONDS: 15,
        MAX_STUCK_TIME: 30000,    // 30 seconds
        CHECK_INTERVAL: 1000,     // 1 second
        MAX_STUCK_COUNT: 5,       // Maximum number of times seconds can be the same
        MAX_RESTART_ATTEMPTS: 3,  // Maximum number of restart attempts
        RESTART_WAIT: 2000        // Wait time after restart
    }
};

// Phone number validation function
function validatePhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    const cleanedNumber = phoneNumber.replace(/\D/g, '');

    // Pattern for phone numbers:
    // - Must start with 1-9
    // - Must be exactly 10 digits
    const phonePattern = /^[1-9]\d{9}$/;

    if (!phonePattern.test(cleanedNumber)) {
        return {
            isValid: false,
            message: 'Invalid phone number format. Must be 10 digits starting with 1-9'
        };
    }

    return {
        isValid: true,
        message: 'Valid phone number'
    };
}

// Utility functions
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function takeScreenshot(page, filename, phoneNumber) {
    try {
        const screenshotsDir = path.join(__dirname, 'screenshots', phoneNumber);
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        const fullPath = path.join(screenshotsDir, path.basename(filename));
        // Delete the file if it already exists
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        await page.screenshot({ path: fullPath });
        return true;
    } catch (error) {
        console.error(`Failed to take screenshot ${filename}:`, error);
        return false;
    }
}

async function waitForElement(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { visible: true, timeout });
        return true;
    } catch (error) {
        console.error(`Element not found ${selector}: ${error.message}`);
        return false;
    }
}

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Route handlers
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});


// Add screenshots endpoint
app.get('/screenshots/:phoneNumber', (req, res) => {
    const phoneNumber = req.params.phoneNumber;

    // Remove session requirement - allow access to screenshots even without active session
    const screenshotsDir = path.join(__dirname, 'screenshots', phoneNumber);
    try {
        // Check if directory exists
        if (!fs.existsSync(screenshotsDir)) {
            return res.status(404).json({
                success: false,
                message: 'No screenshots found for this phone number'
            });
        }

        // Read directory contents
        const files = fs.readdirSync(screenshotsDir);
        const screenshots = files.filter(file =>
            file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
        ).sort((a, b) => {
            // Sort by creation time, newest first
            const statA = fs.statSync(path.join(screenshotsDir, a));
            const statB = fs.statSync(path.join(screenshotsDir, b));
            return statB.mtime.getTime() - statA.mtime.getTime();
        });

        res.json({
            success: true,
            screenshots,
            message: screenshots.length === 0 ? 'No screenshots available yet' : `${screenshots.length} screenshots found`
        });
    } catch (error) {
        console.error('Error reading screenshots directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to read screenshots directory. Please try again.'
        });
    }
});

// Serve screenshots directory
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Add health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Login automation function
async function performTasks(session, phoneNumber, password) {
    try {
        const page = await session.browser.newPage();

        // Set longer timeout for parallel sessions
        const timeout = activeSessionCount > 1 ? 60000 : 30000;
        page.setDefaultTimeout(timeout);

        // Set viewport and user agent for better performance
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        session.log('Login started');

        // Use more reliable navigation options
        await page.goto(CONSTANTS.URLS.LOGIN, {
            waitUntil: 'domcontentloaded',
            timeout: timeout
        });
        session.log('Login page loaded');

        // Wait a bit for page to fully load
        await wait(2000);

        await page.type(CONSTANTS.SELECTORS.LOGIN.PHONE, phoneNumber);
        session.log('Phone entered');

        await page.type(CONSTANTS.SELECTORS.LOGIN.PASSWORD, password);
        session.log('Password entered');

        // Use more reliable navigation for login
        await page.click(CONSTANTS.SELECTORS.LOGIN.SUBMIT);
        await page.waitForNavigation({
            waitUntil: 'domcontentloaded',
            timeout: timeout
        });
        session.log('Login submitted');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.LOGGED_IN, phoneNumber);
        session.log('Login complete');

        if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.TABBAR)) {
            session.log('Task tab missing');
            throw new Error('Task tabbar not found');
        }

        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.van-tabbar-item'));
            const taskTab = tabs.find(tab => tab.textContent.includes('Task'));
            if (taskTab) {
                taskTab.click();
            }
        });

        await page.waitForNavigation({
            waitUntil: 'domcontentloaded',
            timeout: timeout
        });
        session.log('Task page loaded');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_TAB, phoneNumber);

        let remainingTasksCount = await getRemainingTasksCount(page);
        session.log(`Tasks left: ${remainingTasksCount}`);

        while (remainingTasksCount > 0) {
            const result = await handleSingleTask(page, remainingTasksCount, session);
            if (!result.success) {
                session.log(result.message);
                throw new Error(result.message);
            }
            remainingTasksCount = await getRemainingTasksCount(page);
            session.log(`Tasks left: ${remainingTasksCount}`);
        }

        session.log('All tasks done');
        await page.close();
        return { success: true, message: 'All tasks completed' };
    } catch (error) {
        session.log(`Error: ${error.message}`);
        throw error;
    }
}

// Helper function to get remaining tasks count
async function getRemainingTasksCount(page) {
    try {
        const remainingTasksText = await page.evaluate(() => {
            const taskElement = Array.from(document.querySelectorAll('div[data-v-02e24912]'))
                .find(el => el.textContent.includes('Tasks remaining today:'));
            return taskElement ? taskElement.textContent.trim() : '';
        });

        // Extract the number using a more precise regex
        const match = remainingTasksText.match(/Tasks remaining today:\s*(\d+)/);
        const count = match ? parseInt(match[1]) : 0;
        return count;
    } catch (error) {
        console.error(`Error getting remaining tasks count: ${error.message}`);
        return 0;
    }
}

// Helper function to handle video watching
async function handleVideoWatching(page, session) {
    session.log('Video started');
    let watchedSeconds = 0;
    let previousSeconds = 0;
    let stuckCount = 0;
    let startTime = Date.now();

    while (watchedSeconds < CONSTANTS.VIDEO.REQUIRED_SECONDS) {
        if ((Date.now() - startTime) > CONSTANTS.VIDEO.MAX_STUCK_TIME) {
            session.log('Video timeout');
            return false;
        }

        watchedSeconds = await page.evaluate(() => {
            const watchedText = Array.from(document.querySelectorAll('p[data-v-1d18d737]'))
                .find(p => p.textContent.includes('Currently watched'));
            if (watchedText) {
                const secondsMatch = watchedText.textContent.match(/\d+/);
                return secondsMatch ? parseInt(secondsMatch[0]) : 0;
            }
            return 0;
        });

        session.log(`Watched: ${watchedSeconds}s`);

        if (watchedSeconds === previousSeconds) {
            stuckCount++;
            if ((watchedSeconds === 12 || watchedSeconds === 13 || watchedSeconds === 14) && stuckCount > 3) {
                session.log(`Video done at ${watchedSeconds}s`);
                return true;
            }

            if (stuckCount >= CONSTANTS.VIDEO.MAX_STUCK_COUNT) {
                return false;
            }
        } else {
            stuckCount = 0;
            previousSeconds = watchedSeconds;
        }

        if (watchedSeconds >= CONSTANTS.VIDEO.REQUIRED_SECONDS) break;
        await wait(CONSTANTS.VIDEO.CHECK_INTERVAL);
    }

    return true;
}

// Helper function to handle a single task
async function handleSingleTask(page, remainingTasksCount, session) {
    try {
        const taskClicked = await page.evaluate(() => {
            const taskItems = document.querySelectorAll('div[data-v-02e24912].div');
            if (taskItems.length > 0) {
                taskItems[0].click();
                return true;
            }
            return false;
        });

        if (!taskClicked) {
            session.log('No tasks found');
            throw new Error('No task items found');
        }
        session.log('Task selected');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_DETAILS, session.phoneNumber);
        session.log('Task page loaded');

        const adText = await page.evaluate(() => {
            const introDiv = Array.from(document.querySelectorAll('div[data-v-1d18d737]'))
                .find(el => el.textContent.trim() === 'Advertising Introduction');
            if (introDiv) {
                const adTextDiv = introDiv.nextElementSibling;
                return adTextDiv ? adTextDiv.textContent.trim() : '';
            }
            return '';
        });
        session.log(`Ad text: ${adText}`);

        // Only attempt to play the video once per task
        try {
            if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.VIDEO)) {
                session.log('Video missing');
                throw new Error('Video element not found');
            }

            await page.evaluate(() => {
                const playButton = document.querySelector('.vjs-big-play-button');
                if (playButton) {
                    playButton.click();
                }
            });

            await page.waitForFunction(() => {
                const video = document.querySelector('video');
                return video && !video.paused;
            });

            session.log('Video playing');
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.VIDEO_PLAYING, session.phoneNumber);

            const videoSuccess = await handleVideoWatching(page, session);

            if (!videoSuccess) {
                session.log('Video failed');
                // throw new Error('Video watching failed');
                // session.log('No match found');
                await page.goBack({ waitUntil: 'networkidle2', timeout: 10000 });
                await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
                session.log('Back to list');
                await takeScreenshot(page, CONSTANTS.SCREENSHOTS.GO_BACK, session.phoneNumber);
                return { success: true, message: 'Back to list' };
            }
        } catch (error) {
            session.log(`Video error: ${error.message}`);
            throw error;
        }

        await handleAnswerSubmission(page, adText, session);

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_TAB, session.phoneNumber);

        if (remainingTasksCount > 1) {
            return { success: true, message: 'Task done' };
        } else {
            session.log('All done');
            return { success: true, message: 'All tasks done' };
        }

    } catch (error) {
        session.log(`Task error: ${error.message}`);
        if (error.message && error.message.includes('reload and restart task')) {
            session.log('Reloading page and restarting task from task detail...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);

            // Re-navigate to the task tab
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('.van-tabbar-item'));
                const taskTab = tabs.find(tab => tab.textContent.includes('Task'));
                if (taskTab) {
                    taskTab.click();
                }
            });
            await page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);

            // Click the first task again
            const taskClicked = await page.evaluate(() => {
                const taskItems = document.querySelectorAll('div[data-v-02e24912].div');
                if (taskItems.length > 0) {
                    taskItems[0].click();
                    return true;
                }
                return false;
            });
            if (!taskClicked) {
                session.log('No tasks found after reload');
                throw new Error('No task items found after reload');
            }
            session.log('Task selected after reload');
            await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_DETAILS, session.phoneNumber);
            session.log('Task page loaded after reload');

            // Now, recursively call handleSingleTask to restart the process
            return await handleSingleTask(page, remainingTasksCount, session);
        }
        throw error;
    }
}

// Helper function to handle answer submission
async function handleAnswerSubmission(page, adText, session) {
    try {
        await page.evaluate(() => {
            const startButton = document.querySelector('button.van-button--danger .van-button__text');
            if (startButton && startButton.textContent.includes('Start Answering')) {
                startButton.closest('button').click();
            }
        });

        await wait(2000);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.ANSWER_OPTIONS, session.phoneNumber);

        const answerResult = await page.evaluate((adText) => {
            const answers = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                .map(answer => answer.textContent.trim());
            const correctAnswer = answers.find(answer => adText.toLowerCase().includes(answer.toLowerCase()));
            return { answers, correctAnswer, adText };
        }, adText);
        session.log(`Options: ${answerResult.answers}`);
        session.log(`Answer: ${answerResult.correctAnswer}`);

        if (answerResult.correctAnswer) {
            await page.evaluate((correctAnswer) => {
                const answerElement = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                    .find(el => el.textContent.trim() === correctAnswer);
                if (answerElement) {
                    answerElement.click();
                }
            }, answerResult.correctAnswer);
            session.log('Answer selected');

            await wait(CONSTANTS.WAIT_TIMES.ANSWER_BEFORE_SUBMIT);

            await page.evaluate(() => {
                const dangerButtons = document.querySelectorAll('button.van-button--danger');
                const submitBtn = Array.from(dangerButtons).find(button => {
                    const buttonText = button.querySelector('.van-button__text');
                    return buttonText && buttonText.textContent.trim() === 'Submit Answer';
                });
                if (submitBtn) {
                    submitBtn.click()
                }
            });
            session.log('Answer submitted');

            await wait(CONSTANTS.WAIT_TIMES.ANSWER_AFTER_SUBMIT);
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.AFTER_SUBMIT, session.phoneNumber);

            await page.evaluate(() => {
                const backButtons = Array.from(document.querySelectorAll('button.van-button--danger'));
                const backBtn = backButtons.find(button => {
                    const buttonText = button.querySelector('.van-button__text');
                    return buttonText && buttonText.textContent.trim() === 'Back to next';
                });
                if (backBtn) {
                    backBtn.click();
                }
            });
            session.log('Next task');
        } else {
            session.log('No match found');
            await page.goBack({ waitUntil: 'networkidle2', timeout: 10000 });
            await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
            session.log('Back to list');
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.GO_BACK, session.phoneNumber);
            return { success: true, message: 'Back to list' };
        }
    } catch (error) {
        session.log(`Answer error: ${error.message}`);
        throw error;
    }
}

// Session queue management
function addToQueue(session, phoneNumber, password, headless) {
    console.log(`Adding session ${session.id} to queue for ${phoneNumber}, activeSessionCount: ${activeSessionCount}`);
    SESSION_QUEUE.push({ session, phoneNumber, password, headless });
    session.log('Added to queue - waiting for available slot');
    processNextSession();
}

function processNextSession() {
    console.log(`Processing queue: ${SESSION_QUEUE.length} items, activeSessionCount: ${activeSessionCount}, max: ${MAX_CONCURRENT_SESSIONS}`);
    if (SESSION_QUEUE.length > 0 && activeSessionCount < MAX_CONCURRENT_SESSIONS) {
        const { session, phoneNumber, password, headless } = SESSION_QUEUE.shift();
        markSessionAsActive(session);
        console.log(`Starting queued session for ${phoneNumber}, activeSessionCount: ${activeSessionCount}`);
        session.log('Starting from queue');
        startSession(session, phoneNumber, password, headless);
    }
}

async function startSession(session, phoneNumber, password, headless) {
    try {
        session.startTime = Date.now();
        session.log('Starting automation');
        session.isRunning = true;

        // Mark session as active before starting
        markSessionAsActive(session);

        const cachePath = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
        const launchOptions = {
            headless: headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-field-trial-config',
                '--disable-ipc-flooding-protection',
                '--memory-pressure-off',
                '--max_old_space_size=4096',
                '--window-size=1920x1080'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            cacheDirectory: cachePath,
            ignoreDefaultArgs: ['--disable-extensions'],
            env: {
                ...process.env,
                PUPPETEER_CACHE_DIR: cachePath
            }
        };

        try {
            session.browser = await puppeteer.launch(launchOptions);
        } catch (error) {
            session.log(`Browser launch failed: ${error.message}`);
            if (!headless) {
                session.log('Retrying in headless mode');
                launchOptions.headless = true;
                session.browser = await puppeteer.launch(launchOptions);
            } else {
                throw error;
            }
        }

        // Start automation in background with retry logic
        performTasksWithRetry(session, phoneNumber, password);

    } catch (error) {
        session.log(`Start error: ${error.message}`);
        session.stop();
        removeSession(session);
        throw error;
    }
}

// Function to handle successful automation completion
async function handleSuccessfulCompletion(session, phoneNumber) {
    try {
        session.log('Automation completed successfully - starting cleanup');

        // Don't delete screenshots for successful completion - keep them for user review
        session.log('Screenshots preserved for successful completion');

        // Stop the session
        session.stop();

        // Wait a bit before removing session to allow frontend to get final logs
        await wait(3000);

        // Remove session from tracking
        removeSession(session);

        session.log('Cleanup completed successfully');
    } catch (error) {
        session.log(`Error during cleanup: ${error.message}`);
        // Still try to remove session even if cleanup fails
        removeSession(session);
    }
}

async function performTasksWithRetry(session, phoneNumber, password) {
    try {
        await performTasks(session, phoneNumber, password);
        // Tasks completed successfully - use comprehensive cleanup
        session.log('All tasks completed successfully');
        await handleSuccessfulCompletion(session, phoneNumber);
    } catch (error) {
        session.log(`Automation error: ${error.message}`);

        // Retry logic for navigation timeouts
        if (error.message.includes('Navigation timeout') && session.retryCount < session.maxRetries) {
            session.retryCount++;
            session.log(`Retrying automation (attempt ${session.retryCount}/${session.maxRetries})`);

            // Wait before retry
            await wait(5000 * session.retryCount);

            // Restart the session
            try {
                if (session.browser) {
                    await session.browser.close();
                    session.browser = null;
                }
                session.browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--memory-pressure-off',
                        '--max_old_space_size=4096'
                    ]
                });

                await performTasks(session, phoneNumber, password);
                // Tasks completed successfully after retry - use comprehensive cleanup
                session.log('All tasks completed successfully after retry');
                await handleSuccessfulCompletion(session, phoneNumber);
            } catch (retryError) {
                session.log(`Retry failed: ${retryError.message}`);
                session.stop();
                removeSession(session);
            }
        } else {
            // No more retries or different error - clean up session
            session.log('Automation failed - cleaning up session');
            session.stop();
            removeSession(session);
        }
    }
}

// API endpoint for login
app.post('/start', async (req, res) => {
    const { username, password, headless = true } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Phone number and password are required'
        });
    }

    // Validate phone number before proceeding
    const phoneValidation = validatePhoneNumber(username);
    if (!phoneValidation.isValid) {
        return res.status(400).json({
            success: false,
            message: phoneValidation.message
        });
    }

    // Check if this phone number already has a running session
    let existingSession = getSessionByPhone(username);
    if (existingSession && existingSession.isRunning) {
        return res.status(400).json({
            success: false,
            message: 'You already have an automation running. Please stop the current session before starting a new one.'
        });
    }

    // If session exists but not running, reuse it
    if (existingSession && !existingSession.isRunning) {
        existingSession.log('Reusing existing session');

        // Check if we can start immediately or need to queue
        if (activeSessionCount >= MAX_CONCURRENT_SESSIONS) {
            // Add to queue
            addToQueue(existingSession, username, password, headless);
            res.json({
                success: true,
                message: `Automation queued (reused existing session). Currently ${activeSessionCount} active sessions.`,
                sessionId: existingSession.id,
                queued: true
            });
            return;
        } else {
            // Start immediately
            try {
                await startSession(existingSession, username, password, headless);

                res.json({
                    success: true,
                    message: 'Automation started (reused existing session)',
                    sessionId: existingSession.id
                });
                return;
            } catch (error) {
                existingSession.log(`Start error: ${error.message}`);
                existingSession.stop();
                res.status(500).json({
                    success: false,
                    message: `Failed to start automation: ${error.message}`
                });
                return;
            }
        }
    }

    // Create new session
    const session = new AutomationSession(username);
    storeSession(session);

    // Check if we can start immediately or need to queue
    if (activeSessionCount >= MAX_CONCURRENT_SESSIONS) {
        // Add to queue
        addToQueue(session, username, password, headless);
        res.json({
            success: true,
            message: `Automation queued. Currently ${activeSessionCount} active sessions. You will be notified when it starts.`,
            sessionId: session.id,
            queued: true
        });
    } else {
        // Start immediately
        try {
            await startSession(session, username, password, headless);

            res.json({
                success: true,
                message: 'Automation started',
                sessionId: session.id
            });
        } catch (error) {
            session.log(`Start error: ${error.message}`);
            session.stop();
            removeSession(session);
            res.status(500).json({
                success: false,
                message: `Failed to start automation: ${error.message}`
            });
        }
    }
});

// Get logs for specific session
app.get('/logs/:sessionId', (req, res) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }
    res.json({
        success: true,
        logs: session.logs || []
    });
});

// Get logs by phone number
app.get('/logs/phone/:phoneNumber', (req, res) => {
    const session = getSessionByPhone(req.params.phoneNumber);
    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }
    res.json({
        success: true,
        logs: session.logs || []
    });
});

// Stop automation for specific session
app.post('/stop/:sessionId', async (req, res) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }

    try {
        session.log('Stop command received');
        await session.stopAndCleanup();
        removeSessionManually(session);
        res.json({
            success: true,
            message: 'Automation stopped successfully'
        });
    } catch (error) {
        session.log(`Error stopping automation: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Error stopping automation',
            error: error.message
        });
    }
});

// Stop automation by phone number
app.post('/stop/phone/:phoneNumber', async (req, res) => {
    const session = getSessionByPhone(req.params.phoneNumber);
    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }

    try {
        session.log('Stop command received');
        await session.stopAndCleanup();
        removeSessionManually(session);
        res.json({
            success: true,
            message: 'Automation stopped successfully'
        });
    } catch (error) {
        session.log(`Error stopping automation: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Error stopping automation',
            error: error.message
        });
    }
});

// Check queue status
app.get('/queue/status', (req, res) => {
    res.json({
        activeSessions: activeSessionCount,
        maxConcurrent: MAX_CONCURRENT_SESSIONS,
        queuedSessions: SESSION_QUEUE.length,
        queue: SESSION_QUEUE.map(item => ({
            phoneNumber: item.phoneNumber,
            sessionId: item.session.id
        }))
    });
});

// Check if session is active for a phone number
app.get('/session/status/:phoneNumber', (req, res) => {
    const phoneNumber = req.params.phoneNumber;
    const session = getSessionByPhone(phoneNumber);

    if (!session) {
        return res.json({
            success: false,
            isActive: false,
            message: 'No session found for this phone number'
        });
    }

    res.json({
        success: true,
        isActive: session.isRunning,
        sessionId: session.id,
        hasLogs: session.logs && session.logs.length > 0,
        logCount: session.logs ? session.logs.length : 0
    });
});

// Start the server with error handling
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (error) => {
    console.error(`Server failed to start: ${error}`);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});