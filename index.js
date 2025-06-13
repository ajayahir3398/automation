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

let logs = [];
let isRunning = false;
let currentBrowser = null;  // Add this to track the current browser instance

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

// Utility to log and store logs
function log(message) {
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

    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const formattedTime = istTime.toISOString().replace('T', ' ').replace('Z', ' IST');
    
    logs.push(`${formattedTime} - ${emoji} ${message}`);
    if (logs.length > 1000) logs.shift(); // prevent memory overflow
}

async function takeScreenshot(page, filename) {
    try {
        await page.screenshot({ path: filename });
        log(`Screenshot taken and saved as ${filename.split('/').pop()}`);
    } catch (error) {
        log(`Failed to take screenshot ${filename.split('/').pop()}: ${error.message}`);
    }
}

async function waitForElement(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { visible: true, timeout });
        return true;
    } catch (error) {
        log(`Element not found ${selector}: ${error.message}`);
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
app.get('/screenshots', (req, res) => {
    const screenshotsDir = path.join(__dirname, 'screenshots');
    try {
        const files = fs.readdirSync(screenshotsDir);
        const screenshots = files.filter(file =>
            file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
        );
        res.json({ screenshots });
    } catch (error) {
        console.error('Error reading screenshots directory:', error);
        res.status(500).json({ error: 'Failed to read screenshots directory' });
    }
});

// Serve screenshots directory
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Add health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Login automation function
async function performTasks(phoneNumber, password) {
    isRunning = true;
    log('Starting automation');
    let browser;
    try {
        const cachePath = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            cacheDirectory: cachePath,
            ignoreDefaultArgs: ['--disable-extensions'],
            env: {
                ...process.env,
                PUPPETEER_CACHE_DIR: cachePath
            }
        });
        currentBrowser = browser;
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);

        log('Login started');
        await page.goto(CONSTANTS.URLS.LOGIN, { waitUntil: 'networkidle2' });
        log('Login page loaded');

        await page.type(CONSTANTS.SELECTORS.LOGIN.PHONE, phoneNumber);
        log('Entered phone number');

        await page.type(CONSTANTS.SELECTORS.LOGIN.PASSWORD, password);
        log('Entered password');

        await Promise.all([
            page.click(CONSTANTS.SELECTORS.LOGIN.SUBMIT),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        log('Login submitted');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.LOGGED_IN);
        log('Login complete');

        if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.TABBAR)) {
            log('Task tab missing');
            throw new Error('Task tabbar not found');
        }

        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.van-tabbar-item'));
            const taskTab = tabs.find(tab => tab.textContent.includes('Task'));
            if (taskTab) {
                taskTab.click();
            }
        });

        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        log('Task page loaded');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_TAB);

        let remainingTasksCount = await getRemainingTasksCount(page);
        log(`Tasks left: ${remainingTasksCount}`);

        while (remainingTasksCount > 0) {
            const result = await handleSingleTask(page, remainingTasksCount);
            if (!result.success) {
                log(result.message);
                throw new Error(result.message);
            }
            remainingTasksCount = await getRemainingTasksCount(page);
            log(`Tasks left: ${remainingTasksCount}`);
        }

        log('All tasks done');
        await browser.close();
        return { success: true, message: 'All tasks completed' };
    } catch (error) {
        log(`Error: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            currentBrowser = null;
        }
        isRunning = false;
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
        log(`Error getting remaining tasks count: ${error.message}`);
        return 0;
    }
}

// Helper function to handle video watching
async function handleVideoWatching(page) {
    log('Video started');
    let watchedSeconds = 0;
    let previousSeconds = 0;
    let stuckCount = 0;
    let videoRestartAttempts = 0;
    let startTime = Date.now();

    while (watchedSeconds < CONSTANTS.VIDEO.REQUIRED_SECONDS) {
        if ((Date.now() - startTime) > CONSTANTS.VIDEO.MAX_STUCK_TIME) {
            log('Video timeout');
            if (await restartVideo(page)) {
                startTime = Date.now();
                stuckCount = 0;
                previousSeconds = 0;
                continue;
            }
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

        log(`Watched: ${watchedSeconds}s`);

        if (watchedSeconds === previousSeconds) {
            stuckCount++;
            if ((watchedSeconds === 13 || watchedSeconds === 14) && stuckCount > 3) {
                log(`Video done at ${watchedSeconds}s`);
                return true;
            }

            if (stuckCount >= CONSTANTS.VIDEO.MAX_STUCK_COUNT) {
                log('Video stuck');
                if (videoRestartAttempts >= CONSTANTS.VIDEO.MAX_RESTART_ATTEMPTS) {
                    log('Max restarts reached');
                    return false;
                }

                if (await restartVideo(page)) {
                    videoRestartAttempts++;
                    stuckCount = 0;
                    previousSeconds = 0;
                    continue;
                }
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

// Helper function to restart video
async function restartVideo(page) {
    log('Restarting video');
    try {
        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.click();
                if (video.paused) {
                    video.play();
                }
            }
        });
        await wait(1000);

        await page.evaluate(() => {
            const playButton = document.querySelector('.vjs-big-play-button');
            if (playButton) playButton.click();
        });
        await wait(1000);

        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.load();
                video.play();
            }
        });
        await wait(CONSTANTS.VIDEO.RESTART_WAIT);

        const isPlaying = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video && !video.paused;
        });

        if (isPlaying) {
            log('Video restarted');
            return true;
        }

        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.currentTime = 0;
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        document.body.click();
                        video.play();
                    });
                }
            }
        });
        await wait(CONSTANTS.VIDEO.RESTART_WAIT);

        const finalCheck = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video && !video.paused;
        });

        return finalCheck;

    } catch (error) {
        log(`Restart failed: ${error.message}`);
        return false;
    }
}

// Helper function to handle a single task
async function handleSingleTask(page, remainingTasksCount) {
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
            log('No tasks found');
            throw new Error('No task items found');
        }
        log('Task selected');

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_DETAILS);
        log('Task page loaded');

        const adText = await page.evaluate(() => {
            const introDiv = Array.from(document.querySelectorAll('div[data-v-1d18d737]'))
                .find(el => el.textContent.trim() === 'Advertising Introduction');
            if (introDiv) {
                const adTextDiv = introDiv.nextElementSibling;
                return adTextDiv ? adTextDiv.textContent.trim() : '';
            }
            return '';
        });
        log(`Ad text: ${adText}`);

        let videoSuccess = false;
        let videoRetryCount = 0;
        const maxVideoRetries = 3;

        while (!videoSuccess && videoRetryCount < maxVideoRetries) {
            try {
                if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.VIDEO)) {
                    log('Video missing');
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

                log('Video playing');
                await takeScreenshot(page, CONSTANTS.SCREENSHOTS.VIDEO_PLAYING);

                videoSuccess = await handleVideoWatching(page);

                if (!videoSuccess) {
                    videoRetryCount++;
                    log(`Retry ${videoRetryCount}/${maxVideoRetries}`);
                    if (videoRetryCount < maxVideoRetries) {
                        await wait(1000);
                    }
                }
            } catch (error) {
                log(`Video error: ${error.message}`);
                videoRetryCount++;
                if (videoRetryCount < maxVideoRetries) {
                    await wait(1000);
                }
            }
        }

        if (!videoSuccess) {
            log('Video failed');
            throw new Error('Video watching failed');
        }

        await handleAnswerSubmission(page, adText);

        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_TAB);

        if (remainingTasksCount > 1) {
            return { success: true, message: 'Task done' };
        } else {
            log('All done');
            return { success: true, message: 'All tasks done' };
        }

    } catch (error) {
        log(`Task error: ${error.message}`);
        throw error;
    }
}

// Helper function to handle answer submission
async function handleAnswerSubmission(page, adText) {
    try {
        await page.evaluate(() => {
            const startButton = document.querySelector('button.van-button--danger .van-button__text');
            if (startButton && startButton.textContent.includes('Start Answering')) {
                startButton.closest('button').click();
            }
        });

        await wait(2000);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.ANSWER_OPTIONS);

        const answerResult = await page.evaluate((adText) => {
            const answers = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                .map(answer => answer.textContent.trim());
            const correctAnswer = answers.find(answer => adText.toLowerCase().includes(answer.toLowerCase()));
            return { answers, correctAnswer, adText };
        }, adText);
        log(`Options: ${answerResult.answers}`);
        log(`Answer: ${answerResult.correctAnswer}`);

        if (answerResult.correctAnswer) {
            await page.evaluate((correctAnswer) => {
                const answerElement = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                    .find(el => el.textContent.trim() === correctAnswer);
                if (answerElement) {
                    answerElement.click();
                }
            }, answerResult.correctAnswer);
            log('Answer selected');

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
            log('Answer submitted');

            await wait(CONSTANTS.WAIT_TIMES.ANSWER_AFTER_SUBMIT);
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.AFTER_SUBMIT);

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
            log('Next task');
        } else {
            log('No match found');
            await page.goBack({ waitUntil: 'networkidle2', timeout: 10000 });
            await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
            log('Back to list');
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.GO_BACK);
            return { success: true, message: 'Back to list' };
        }
    } catch (error) {
        log(`Answer error: ${error.message}`);
        throw error;
    }
}

// API endpoint for login
app.post('/start', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        log('Missing phone number or password');
        return res.status(400).json({
            success: false,
            message: 'Phone number and password are required'
        });
    }

    // Validate phone number before proceeding
    const phoneValidation = validatePhoneNumber(username);
    if (!phoneValidation.isValid) {
        log('Invalid phone number');
        return res.status(400).json({
            success: false,
            message: phoneValidation.message
        });
    }

    if (isRunning) {
        log('Automation already running');
        return res.status(400).json({ message: 'Automation already running' });
    }

    logs = [];
    performTasks(username, password);
    res.json({ message: 'Automation started' });

});

app.get('/logs', (req, res) => {
    res.json({ logs });
});

app.post('/clear', (req, res) => {
    logs = [];
    res.json({ status: 'success' });
});

// API endpoint for stop
app.post('/stop', async (req, res) => {
    try {
        if (!isRunning) {
            return res.json({ message: 'No automation running' });
        }

        log('Stop command received');
        isRunning = false;

        // Close the browser if it exists
        if (currentBrowser) {
            log('Closing browser...');
            await currentBrowser.close();
            currentBrowser = null;
            log('Browser closed successfully');
        }

        res.json({ message: 'Automation stopped successfully' });
    } catch (error) {
        log(`Error stopping automation: ${error.message}`);
        res.status(500).json({ message: 'Error stopping automation', error: error.message });
    }
});

// Start the server with error handling
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (error) => {
    console.log(`Server failed to start: ${error}`);
    log(`Server failed to start: ${error}`);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        log('Server closed');
        process.exit(0);
    });
});
