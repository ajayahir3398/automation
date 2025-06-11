const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');
const app = express();

// Middleware to parse JSON bodies and serve static files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Serve the login form at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Login automation function
async function performLogin(phoneNumber, password) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log('Starting login process');
        await page.goto('https://dteworks.com/xml/index.html#/login', { waitUntil: 'networkidle2' });
        console.log('Navigated to login page');

        // Update selectors based on the actual login page
        await page.type('input[type="tel"][placeholder="Please enter your phone number"]', phoneNumber);
        console.log('Entered phone number');

        await page.type('input[type="password"][placeholder="Please enter login password"]', password);
        console.log('Entered password');

        await Promise.all([
            page.click('button.van-button--danger'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        console.log('Clicked login button and waiting for navigation');

        // Wait for 3 seconds before taking screenshot
        console.log('Waiting 3 seconds for page to load');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Take screenshot for verification
        await page.screenshot({ path: 'screenshots/loggedin.png' });
        console.log('Screenshot taken and saved as loggedin.png');

        // Verify login success
        const currentUrl = await page.url();
        console.log('Current URL after login:', currentUrl);
        console.log('Login process completed successfully');

        // Wait for the tabbar to be visible
        await page.waitForSelector('.van-tabbar', { visible: true });
        console.log('Tabbar is visible');
        // Click the Task tab
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.van-tabbar-item'));
            const taskTab = tabs.find(tab => tab.textContent.includes('Task'));
            if (taskTab) {
                taskTab.click();
                console.log('Clicked Task tab');
            }
        });

        // Wait for navigation after clicking Task tab
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log('Navigated to Task page');

        // Wait for 3 seconds before taking screenshot
        console.log('Waiting 3 seconds for page to load');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await page.screenshot({ path: 'screenshots/tasktab.png' });
        console.log('Screenshot taken and saved as tasktab.png');

        // Use the helper function to get remaining tasks count
        remainingTasksCount = await getRemainingTasksCount(page);
        console.log('Remaining tasks count:', remainingTasksCount);

        if (remainingTasksCount > 0) {
            await handleSingleTask(page);
        } else {
            console.log('No remaining tasks for today');
            await browser.close();
            return { success: true, message: 'All tasks completed successfully' };
        }

    } catch (error) {
        console.error('Error occurred:', error.message);
        await browser.close();
        return { success: false, message: error.message };
    }
}

// Helper function to get remaining tasks count
async function getRemainingTasksCount(page) {
    const remainingTasksText = await page.evaluate(() => {
        const taskElement = Array.from(document.querySelectorAll('div[data-v-02e24912]'))
            .find(el => el.textContent.includes('Tasks remaining today:'));
        return taskElement ? taskElement.textContent : '';
    });
    const match = remainingTasksText.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

// Helper function to handle a single task
async function handleSingleTask(page) {
    // Wait for the task list to be visible
    await page.waitForSelector('div[data-v-02e24912][role="feed"].van-list', { visible: true });
    console.log('Task list is visible');

    // Click the first task item
    await page.evaluate(() => {
        const taskItems = document.querySelectorAll('div[data-v-02e24912].div');
        if (taskItems.length > 0) {
            taskItems[0].click();
            console.log('Clicked first task item');
        }
    });

    // Wait for navigation after clicking the task
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Navigated to task details page');

    // Wait for 3 seconds before taking screenshot
    console.log('Waiting 3 seconds for page to load');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot of task details
    await page.screenshot({ path: 'screenshots/taskdetails.png' });
    console.log('Screenshot taken of task details page');

    // Get the text after "Advertising Introduction"
    console.log('Getting advertisement text');
    const adText = await page.evaluate(() => {
        const introDiv = Array.from(document.querySelectorAll('div[data-v-1d18d737]'))
            .find(el => el.textContent.trim() === 'Advertising Introduction');
        if (introDiv) {
            // Get the next div which contains the ad text
            const adTextDiv = introDiv.nextElementSibling;
            return adTextDiv ? adTextDiv.textContent.trim() : '';
        }
        return '';
    });
    console.log('Advertisement text:', adText);

    // Wait for video element to be visible
    await page.waitForSelector('div[data-v-1d18d737].taskVideo', { visible: true });
    console.log('Video element is visible');

    // Click the big play button to start the video
    await page.evaluate(() => {
        const playButton = document.querySelector('.vjs-big-play-button');
        if (playButton) {
            playButton.click();
            console.log('Clicked play button');
        }
    });

    // Wait for video to start playing
    await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && !video.paused;
    });
    console.log('Video started playing');

    // Wait for 3 seconds to ensure video is playing
    console.log('Waiting 3 seconds for video to play');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot of task details
    await page.screenshot({ path: 'screenshots/videoPlaying.png' });
    console.log('Screenshot taken of video playing');

    // Check watched seconds repeatedly
    console.log('Checking watched seconds...');
    let watchedSeconds = 0;
    while (watchedSeconds < 15) {
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
        if (watchedSeconds >= 15) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Wait for 3 seconds to ensure video is played for required duration
    console.log('Waiting 3 seconds for ensure video is played for required duration');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click the Start Answering button
    await page.evaluate(() => {
        const startButton = document.querySelector('button.van-button--danger .van-button__text');
        if (startButton && startButton.textContent.includes('Start Answering')) {
            startButton.closest('button').click();
            console.log('Clicked Start Answering button');
        }
    });

    // Wait for navigation with increased timeout
    console.log('Waiting for navigation to answer page...');
    await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    console.log('Navigated to answer page');

    // Take screenshot of answer page
    await page.screenshot({ path: 'screenshots/answerPage.png' });
    console.log('Screenshot taken of answer page');

    // Get answer options and check against adText
    const answerResult = await page.evaluate((adText) => {
        const answers = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
            .map(answer => answer.textContent.trim());
        answers.findIndex(answer => answer.includes('BVLGARI')) !== -1 ? answers.push('Bulgari') : '';
        const correctAnswer = answers.find(answer => adText.toLowerCase().includes(answer.toLowerCase()));
        return { answers, correctAnswer, adText };
    }, adText);
    console.log('Answer options:', answerResult.answers);
    console.log('Correct answer:', answerResult.correctAnswer);
    console.log('Advertisement text:', answerResult.adText);

    // Click the correct answer
    if (answerResult.correctAnswer) {
        await page.evaluate((correctAnswer) => {
            const answerElement = Array.from(document.querySelectorAll('div[data-v-1d18d737].answer'))
                .find(el => el.textContent.trim() === correctAnswer);
            if (answerElement) {
                answerElement.click();
                console.log('Clicked correct answer:', correctAnswer);
            }
        }, answerResult.correctAnswer);

        // Wait for 2 seconds before submitting
        console.log('Waiting 2 seconds before submitting answer');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Click the Submit Answer button
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

        // Wait for 2 seconds before submitting
        console.log('Waiting 2 seconds before submitting answer');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Take screenshot after submitting
        await page.screenshot({ path: 'screenshots/afterSubmit.png' });
        console.log('Screenshot taken after submitting answer');

        // Wait for 2 seconds before clicking Back to next
        console.log('Waiting 2 seconds before clicking Back to next');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Click the Back to next button
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

        // Take screenshot after clicking back
        await new Promise(resolve => setTimeout(resolve, 2000));
        await page.screenshot({ path: 'screenshots/afterBack.png' });
        console.log('Screenshot taken after clicking Back to next');
    }

    // Wait for 3 seconds before next iteration
    console.log('Waiting 3 seconds before next task');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Use the helper function to get remaining tasks count
    remainingTasksCount = await getRemainingTasksCount(page);
    console.log('Remaining tasks count:', remainingTasksCount);

    if (remainingTasksCount > 0) {
        await handleSingleTask(page);
    } else {
        console.log('No remaining tasks for today');
        await browser.close();
        return { success: true, message: 'All tasks completed successfully' };
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

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
