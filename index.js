const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');
const app = express();

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

// Constants
const CONSTANTS = {
    WAIT_TIMES: {
        PAGE_LOAD: 3000,
        VIDEO_PLAY: 3000,
        ANSWER_SUBMIT: 2000,
        NEXT_TASK: 3000
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
        ANSWER_PAGE: 'screenshots/answerPage.png',
        AFTER_SUBMIT: 'screenshots/afterSubmit.png',
        AFTER_BACK: 'screenshots/afterBack.png'
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

// Utility functions
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function takeScreenshot(page, filename) {
    try {
        await page.screenshot({ path: filename });
        console.log(`Screenshot taken and saved as ${filename}`);
    } catch (error) {
        console.error(`Failed to take screenshot ${filename}:`, error.message);
    }
}

async function waitForElement(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { visible: true, timeout });
        return true;
    } catch (error) {
        console.error(`Element not found: ${selector}`, error.message);
        return false;
    }
}

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Route handlers
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Add health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Login automation function
async function performLogin(phoneNumber, password) {
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
            executablePath: '/tmp/puppeteer-cache/chrome/linux-137.0.7151.55/chrome-linux64/chrome',
            cacheDirectory: cachePath,
            ignoreDefaultArgs: ['--disable-extensions'],
            env: {
                ...process.env,
                PUPPETEER_CACHE_DIR: cachePath
            }
        });
        const page = await browser.newPage();

        // Set default timeout
        page.setDefaultTimeout(30000);

        console.log('Starting login process');
        await page.goto(CONSTANTS.URLS.LOGIN, { waitUntil: 'networkidle2' });
        console.log('Navigated to login page');

        // Fill login form
        await page.type(CONSTANTS.SELECTORS.LOGIN.PHONE, phoneNumber);
        console.log('Entered phone number');

        await page.type(CONSTANTS.SELECTORS.LOGIN.PASSWORD, password);
        console.log('Entered password');

        // Submit login
        await Promise.all([
            page.click(CONSTANTS.SELECTORS.LOGIN.SUBMIT),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        console.log('Clicked login button and waiting for navigation');

        // Wait for page load and take screenshot
        console.log('Waiting 3 seconds for page to load');
        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.LOGGED_IN);

        // Verify login success
        const currentUrl = await page.url();
        console.log('Current URL after login:', currentUrl);
        console.log('Login process completed successfully');

        // Navigate to task tab
        console.log('Waiting for tabbar to be visible');
        if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.TABBAR)) {
            throw new Error('Task tabbar not found');
        }
        console.log('Tabbar is visible');

        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.van-tabbar-item'));
            const taskTab = tabs.find(tab => tab.textContent.includes('Task'));
            if (taskTab) {
                taskTab.click();
                console.log('Clicked Task tab');
            }
        });

        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log('Navigated to Task page');

        console.log('Waiting 3 seconds for page to load');
        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_TAB);

        let remainingTasksCount = await getRemainingTasksCount(page);
        console.log('Initial remaining tasks count:', remainingTasksCount);

        while (remainingTasksCount > 0) {
            const result = await handleSingleTask(page);
            if (!result.success) {
                throw new Error(result.message);
            }
            
            // Wait before checking remaining tasks
            await wait(3000);
            remainingTasksCount = await getRemainingTasksCount(page);
            console.log('Updated remaining tasks count:', remainingTasksCount);
        }

        console.log('All tasks completed successfully');
        await browser.close();
        return { success: true, message: 'All tasks completed successfully' };

    } catch (error) {
        console.error('Error in performLogin:', error.message);
        if (browser) await browser.close();
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
        
        console.log('Found remaining tasks text:', remainingTasksText);
        console.log('Extracted count:', count);
        
        return count;
    } catch (error) {
        console.error('Error getting remaining tasks count:', error.message);
        return 0;
    }
}

// Helper function to handle video watching
async function handleVideoWatching(page) {
    console.log('Starting video watching process');
    let watchedSeconds = 0;
    let previousSeconds = 0;
    let stuckCount = 0;
    let videoRestartAttempts = 0;
    const startTime = Date.now();

    while (watchedSeconds < CONSTANTS.VIDEO.REQUIRED_SECONDS) {
        // Check if we've been stuck too long
        if (Date.now() - startTime > CONSTANTS.VIDEO.MAX_STUCK_TIME) {
            console.log('Video watching timeout reached, attempting to restart video');
            if (await restartVideo(page)) {
                // Reset counters after successful restart
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

        console.log('Currently watched seconds:', watchedSeconds);

        // Check if seconds are stuck
        if (watchedSeconds === previousSeconds) {
            stuckCount++;
            // If we're stuck at 13 or 14 seconds, and it's been a few checks, consider the video complete
            if ((watchedSeconds === 13 || watchedSeconds === 14) && stuckCount >= 3) {
                console.log(`Video appears to be complete at ${watchedSeconds} seconds (shorter video)`);
                return true;
            }
            
            if (stuckCount >= CONSTANTS.VIDEO.MAX_STUCK_COUNT) {
                console.log('Video appears to be stuck, attempting to restart');
                if (videoRestartAttempts >= CONSTANTS.VIDEO.MAX_RESTART_ATTEMPTS) {
                    console.log('Maximum restart attempts reached');
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
    console.log('Attempting to restart video');
    try {
        // First try: Click the video element
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

        // Second try: Click the play button
        await page.evaluate(() => {
            const playButton = document.querySelector('.vjs-big-play-button');
            if (playButton) playButton.click();
        });
        await wait(1000);

        // Third try: Reload the video
        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.load();
                video.play();
            }
        });
        await wait(CONSTANTS.VIDEO.RESTART_WAIT);

        // Verify if video is playing
        const isPlaying = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video && !video.paused;
        });

        if (isPlaying) {
            console.log('Video successfully restarted');
            return true;
        }

        // Fourth try: Force play through JavaScript
        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.currentTime = 0;
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        // If autoplay is blocked, try to play on user interaction
                        document.body.click();
                        video.play();
                    });
                }
            }
        });
        await wait(CONSTANTS.VIDEO.RESTART_WAIT);

        // Final check
        const finalCheck = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video && !video.paused;
        });

        return finalCheck;

    } catch (error) {
        console.error('Error restarting video:', error.message);
        return false;
    }
}

// Helper function to handle a single task
async function handleSingleTask(page) {
    try {
        console.log('Waiting for task list to be visible');
        
        // Add retry mechanism for task list visibility
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                await page.waitForSelector(CONSTANTS.SELECTORS.TASK.TASK_LIST, { 
                    visible: true,
                    timeout: 10000 
                });
                console.log('Task list is visible');
                break;
            } catch (error) {
                retryCount++;
                console.log(`Retry ${retryCount}/${maxRetries} for task list visibility`);
                if (retryCount === maxRetries) {
                    throw new Error('Task list not found after multiple retries');
                }
                await wait(2000); // Wait 2 seconds before retrying
            }
        }

        // Click first task
        const taskClicked = await page.evaluate(() => {
            const taskItems = document.querySelectorAll('div[data-v-02e24912].div');
            if (taskItems.length > 0) {
                taskItems[0].click();
                return true;
            }
            return false;
        });

        if (!taskClicked) {
            throw new Error('No task items found to click');
        }
        console.log('Clicked first task item');

        // Wait for navigation with timeout
        try {
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
                wait(5000)
            ]);
        } catch (error) {
            console.log('Navigation timeout, continuing anyway');
        }
        console.log('Navigated to task details page');

        console.log('Waiting 3 seconds for page to load');
        await wait(CONSTANTS.WAIT_TIMES.PAGE_LOAD);
        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.TASK_DETAILS);

        // Get advertisement text
        console.log('Getting advertisement text');
        const adText = await page.evaluate(() => {
            const introDiv = Array.from(document.querySelectorAll('div[data-v-1d18d737]'))
                .find(el => el.textContent.trim() === 'Advertising Introduction');
            if (introDiv) {
                const adTextDiv = introDiv.nextElementSibling;
                return adTextDiv ? adTextDiv.textContent.trim() : '';
            }
            return '';
        });
        console.log('Advertisement text:', adText);

        // Handle video playback with retry
        let videoSuccess = false;
        let videoRetryCount = 0;
        const maxVideoRetries = 3;

        while (!videoSuccess && videoRetryCount < maxVideoRetries) {
            try {
                console.log('Waiting for video element to be visible');
                if (!await waitForElement(page, CONSTANTS.SELECTORS.TASK.VIDEO)) {
                    throw new Error('Video element not found');
                }
                console.log('Video element is visible');

                await page.evaluate(() => {
                    const playButton = document.querySelector('.vjs-big-play-button');
                    if (playButton) {
                        playButton.click();
                        console.log('Clicked play button');
                    }
                });

                await page.waitForFunction(() => {
                    const video = document.querySelector('video');
                    return video && !video.paused;
                });
                console.log('Video started playing');

                console.log('Waiting 3 seconds for video to play');
                await wait(CONSTANTS.WAIT_TIMES.VIDEO_PLAY);
                await takeScreenshot(page, CONSTANTS.SCREENSHOTS.VIDEO_PLAYING);

                videoSuccess = await handleVideoWatching(page);
                if (!videoSuccess) {
                    videoRetryCount++;
                    console.log(`Video watching failed, attempt ${videoRetryCount}/${maxVideoRetries}`);
                    if (videoRetryCount < maxVideoRetries) {
                        await wait(2000);
                    }
                }
            } catch (error) {
                console.error('Error during video playback:', error.message);
                videoRetryCount++;
                if (videoRetryCount < maxVideoRetries) {
                    await wait(2000);
                }
            }
        }

        if (!videoSuccess) {
            throw new Error('Failed to watch video after multiple attempts');
        }

        // Handle answer submission
        await handleAnswerSubmission(page, adText);

        // Check remaining tasks
        const remainingTasksCount = await getRemainingTasksCount(page);
        console.log('Remaining tasks count:', remainingTasksCount);

        if (remainingTasksCount > 0) {
            // Instead of recursive call, return to performLogin
            return { success: true, message: 'Task completed, more tasks available' };
        } else {
            console.log('No remaining tasks for today');
            return { success: true, message: 'All tasks completed successfully' };
        }

    } catch (error) {
        console.error('Error in handleSingleTask:', error.message);
        throw error;
    }
}

// Helper function to handle answer submission
async function handleAnswerSubmission(page, adText) {
    try {
        // Click Start Answering
        await page.evaluate(() => {
            const startButton = document.querySelector('button.van-button--danger .van-button__text');
            if (startButton && startButton.textContent.includes('Start Answering')) {
                startButton.closest('button').click();
                console.log('Clicked Start Answering button');
            }
        });

        console.log('Waiting for navigation to answer page...');
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            wait(5000)
        ]);
        console.log('Navigated to answer page');

        await takeScreenshot(page, CONSTANTS.SCREENSHOTS.ANSWER_PAGE);

        // Get and submit answer
        const answerResult = await page.evaluate((adText) => {
            const answers = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                .map(answer => answer.textContent.trim());
            answers.findIndex(answer => answer.includes('BVLGARI')) !== -1 ? answers.push('Bulgari') : '';
            answers.findIndex(answer => answer.includes('MontresBreguet')) !== -1 ? answers.push('Breguet') : '';
            answers.findIndex(answer => answer.includes('hermes')) !== -1 ? answers.push('Hermès') : '';
            const correctAnswer = answers.find(answer => adText.toLowerCase().includes(answer.toLowerCase()));
            return { answers, correctAnswer, adText };
        }, adText);
        console.log('Answer options:', answerResult.answers);
        console.log('Correct answer:', answerResult.correctAnswer);
        console.log('Advertisement text:', answerResult.adText);

        if (answerResult.correctAnswer) {
            await page.evaluate((correctAnswer) => {
                const answerElement = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                    .find(el => el.textContent.trim() === correctAnswer);
                if (answerElement) {
                    answerElement.click();
                    console.log('Clicked correct answer:', correctAnswer);
                }
            }, answerResult.correctAnswer);

            console.log('Waiting 2 seconds before submitting answer');
            await wait(CONSTANTS.WAIT_TIMES.ANSWER_SUBMIT);

            // Submit answer
            await page.evaluate(() => {
                const dangerButtons = document.querySelectorAll('button.van-button--danger');
                const submitBtn = Array.from(dangerButtons).find(button => {
                    const buttonText = button.querySelector('.van-button__text');
                    return buttonText && buttonText.textContent.trim() === 'Submit Answer';
                });
                if (submitBtn) {
                    submitBtn.click();
                    console.log('Clicked Submit Answer button');
                }
            });

            console.log('Waiting 2 seconds before taking screenshot');
            await wait(CONSTANTS.WAIT_TIMES.ANSWER_SUBMIT);
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.AFTER_SUBMIT);

            // Click Back to next
            console.log('Waiting 2 seconds before clicking Back to next');
            await wait(CONSTANTS.WAIT_TIMES.ANSWER_SUBMIT);

            await page.evaluate(() => {
                const backButtons = Array.from(document.querySelectorAll('button.van-button--danger'));
                const backBtn = backButtons.find(button => {
                    const buttonText = button.querySelector('.van-button__text');
                    return buttonText && buttonText.textContent.trim() === 'Back to next';
                });
                if (backBtn) {
                    backBtn.click();
                    console.log('Clicked Back to next button');
                }
            });

            await wait(CONSTANTS.WAIT_TIMES.ANSWER_SUBMIT);
            await takeScreenshot(page, CONSTANTS.SCREENSHOTS.AFTER_BACK);
        } else {
            // If no match found, throw error with detailed information
            throw new Error(`No matching answer found. Advertisement text: "${answerResult.adText}". Available answers: ${answerResult.answers.join(', ')}`);
        }

    } catch (error) {
        console.error('Error in handleAnswerSubmission:', error.message);
        throw error;
    }
}

// API endpoint for login
app.post('/login', async (req, res) => {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
        console.error('Missing phone number or password');
        return res.status(400).json({
            success: false,
            message: 'Phone number and password are required'
        });
    }

    try {
        const result = await performLogin(phoneNumber, password);
        res.json(result);
    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Start the server with error handling
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (error) => {
    console.error('Server failed to start:', error);
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
