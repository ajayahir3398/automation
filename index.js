const puppeteer = require("puppeteer")
const express = require("express")
const path = require("path")
const fs = require("fs")
const EventEmitter = require("events")

const app = express()

// Enhanced error handling
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
})

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error)
})

// Configuration constants
const CONFIG = {
  MAX_CONCURRENT_SESSIONS: 3,
  SESSION_TIMEOUT: 300000, // 5 minutes
  LOG_RETENTION_LIMIT: 1000,
  WAIT_TIMES: {
    PAGE_LOAD: 2000,
    ANSWER_BEFORE_SUBMIT: 2000,
    ANSWER_AFTER_SUBMIT: 2000,
    RETRY_DELAY: 5000,
  },
  SELECTORS: {
    LOGIN: {
      PHONE: 'input[type="tel"][placeholder="Please enter your phone number"]',
      PASSWORD: 'input[type="password"][placeholder="Please enter login password"]',
      SUBMIT: "button.van-button--danger",
    },
    TASK: {
      TABBAR: ".van-tabbar",
      TASK_LIST: 'div[data-v-02e24912][role="feed"].van-list',
      TASK_ITEM: "div[data-v-02e24912].div",
      VIDEO: "video",
      PLAY_BUTTON: ".vjs-big-play-button",
      ANSWER: "div[data-v-1d18d737].answer",
      START_ANSWERING: "button.van-button--danger .van-button__text",
      SUBMIT_ANSWER: "button.van-button--danger",
    },
  },
  URLS: {
    LOGIN: "https://dteworks.com/xml/index.html#/login",
  },
  VIDEO: {
    REQUIRED_SECONDS: 15,
    MAX_WAIT_TIME: 45000, // Increased to 45 seconds
    CHECK_INTERVAL: 1000,
    MAX_STUCK_COUNT: 5, // Reduced for faster detection
    RESTART_ATTEMPTS: 3,
    RESTART_WAIT: 3000,
  },
}

// Enhanced session management
class SessionManager extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map()
    this.sessionIds = new Map()
    this.queue = []
    this.activeCount = 0
  }

  createSession(phoneNumber) {
    const session = new AutomationSession(phoneNumber)
    this.sessions.set(phoneNumber, session)
    this.sessionIds.set(session.id, phoneNumber)

    session.on("completed", () => this.handleSessionComplete(session))
    session.on("failed", () => this.handleSessionComplete(session))

    return session
  }

  getByPhone(phoneNumber) {
    return this.sessions.get(phoneNumber)
  }

  getById(sessionId) {
    const phoneNumber = this.sessionIds.get(sessionId)
    return phoneNumber ? this.sessions.get(phoneNumber) : null
  }

  addToQueue(session, phoneNumber, password, headless) {
    this.queue.push({ session, phoneNumber, password, headless })
    session.log("Added to queue - waiting for available slot")
    this.processQueue()
  }

  processQueue() {
    if (this.queue.length > 0 && this.activeCount < CONFIG.MAX_CONCURRENT_SESSIONS) {
      const { session, phoneNumber, password, headless } = this.queue.shift()
      this.startSession(session, phoneNumber, password, headless)
    }
  }

  async startSession(session, phoneNumber, password, headless) {
    try {
      this.activeCount++
      session.markAsActive()
      await session.start(phoneNumber, password, headless)
    } catch (error) {
      console.error(`Failed to start session for ${phoneNumber}:`, error)
      this.handleSessionComplete(session)
    }
  }

  handleSessionComplete(session) {
    if (session.isActive) {
      this.activeCount--
      session.markAsInactive()
    }
    this.processQueue()
  }

  removeSession(session) {
    this.sessions.delete(session.phoneNumber)
    this.sessionIds.delete(session.id)
    this.handleSessionComplete(session)
  }
}

// Enhanced automation session class
class AutomationSession extends EventEmitter {
  constructor(phoneNumber) {
    super()
    this.id = Date.now().toString()
    this.phoneNumber = phoneNumber
    this.logs = []
    this.isRunning = false
    this.isActive = false
    this.browser = null
    this.page = null
    this.startTime = null
    this.retryCount = 0
    this.maxRetries = 2
    this.videoRestartCount = 0
  }

  log(message) {
    const emoji = this.getLogEmoji(message)
    const timestamp = this.getTimestamp()
    const logEntry = `${timestamp} - ${emoji} ${message}`

    console.log(logEntry)
    this.logs.push(logEntry)

    if (this.logs.length > CONFIG.LOG_RETENTION_LIMIT) {
      this.logs.shift()
    }
  }

  getLogEmoji(message) {
    const lowerMessage = message.toLowerCase()
    const emojiMap = {
      error: "❌",
      failed: "❌",
      phone: "📱",
      password: "🔒",
      success: "✅",
      completed: "✅",
      start: "🚀",
      begin: "🚀",
      stop: "🛑",
      end: "🛑",
      wait: "⏳",
      loading: "⏳",
      login: "🔑",
      navigate: "🌐",
      page: "🌐",
      click: "👆",
      type: "⌨️",
      enter: "⌨️",
      screenshot: "📸",
      video: "📺",
      play: "📺",
      watch: "📺",
      task: "📋",
      answer: "✍️",
    }

    for (const [keyword, emoji] of Object.entries(emojiMap)) {
      if (lowerMessage.includes(keyword)) return emoji
    }
    return "📝"
  }

  getTimestamp() {
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istTime = new Date(now.getTime() + istOffset)

    const day = istTime.getUTCDate().toString().padStart(2, "0")
    const month = (istTime.getUTCMonth() + 1).toString().padStart(2, "0")
    const year = istTime.getUTCFullYear().toString().slice(-2)
    const hours = istTime.getUTCHours().toString().padStart(2, "0")
    const minutes = istTime.getUTCMinutes().toString().padStart(2, "0")
    const seconds = istTime.getUTCSeconds().toString().padStart(2, "0")

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
  }

  markAsActive() {
    this.isActive = true
  }

  markAsInactive() {
    this.isActive = false
  }

  async start(phoneNumber, password, headless) {
    try {
      this.startTime = Date.now()
      this.isRunning = true
      this.log("Starting automation")

      await this.initializeBrowser(headless)
      await this.performTasks(phoneNumber, password)

      this.log("All tasks completed successfully")
      this.emit("completed")
    } catch (error) {
      this.log(`Automation error: ${error.message}`)
      await this.handleError(error, phoneNumber, password)
    }
  }

  async initializeBrowser(headless) {
    const launchOptions = {
      headless: headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--memory-pressure-off",
        "--max_old_space_size=4096",
        "--window-size=1920x1080",
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      ignoreDefaultArgs: ["--disable-extensions"],
    }

    try {
      this.browser = await puppeteer.launch(launchOptions)
    } catch (error) {
      if (!headless) {
        this.log("Browser launch failed, retrying in headless mode")
        launchOptions.headless = true
        this.browser = await puppeteer.launch(launchOptions)
      } else {
        throw error
      }
    }
  }

  async performTasks(phoneNumber, password) {
    this.page = await this.browser.newPage()

    // Enhanced page configuration
    await this.page.setViewport({ width: 1920, height: 1080 })
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )

    // Set longer timeout for better reliability
    this.page.setDefaultTimeout(60000)

    // Perform login
    await this.login(phoneNumber, password)

    // Navigate to tasks
    await this.navigateToTasks()

    // Process all tasks
    await this.processTasks()
  }

  async login(phoneNumber, password) {
    this.log("Login started")

    await this.page.goto(CONFIG.URLS.LOGIN, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    this.log("Login page loaded")

    await this.wait(2000)

    await this.page.type(CONFIG.SELECTORS.LOGIN.PHONE, phoneNumber)
    this.log("Phone entered")

    await this.page.type(CONFIG.SELECTORS.LOGIN.PASSWORD, password)
    this.log("Password entered")

    await this.page.click(CONFIG.SELECTORS.LOGIN.SUBMIT)
    await this.page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    this.log("Login submitted")
    await this.wait(CONFIG.WAIT_TIMES.PAGE_LOAD)
    await this.takeScreenshot("loggedin.png")
    this.log("Login complete")
  }

  async navigateToTasks() {
    if (!(await this.waitForElement(CONFIG.SELECTORS.TASK.TABBAR))) {
      throw new Error("Task tabbar not found")
    }

    await this.page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll(".van-tabbar-item"))
      const taskTab = tabs.find((tab) => tab.textContent.includes("Task"))
      if (taskTab) {
        taskTab.click()
      }
    })

    await this.page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    this.log("Task page loaded")
    await this.wait(CONFIG.WAIT_TIMES.PAGE_LOAD)
    await this.takeScreenshot("tasktab.png")
  }

  async processTasks() {
    let remainingTasks = await this.getRemainingTasksCount()
    this.log(`Tasks left: ${remainingTasks}`)

    while (remainingTasks > 0) {
      const result = await this.handleSingleTask(remainingTasks)
      if (!result.success) {
        this.log(result.message)
        throw new Error(result.message)
      }
      remainingTasks = await this.getRemainingTasksCount()
      this.log(`Tasks left: ${remainingTasks}`)
    }

    this.log("All tasks completed")
  }

  async handleSingleTask(remainingTasksCount) {
    try {
      // Click on first task
      const taskClicked = await this.page.evaluate(() => {
        const taskItems = document.querySelectorAll("div[data-v-02e24912].div")
        if (taskItems.length > 0) {
          taskItems[0].click()
          return true
        }
        return false
      })

      if (!taskClicked) {
        throw new Error("No task items found")
      }

      this.log("Task selected")
      await this.wait(CONFIG.WAIT_TIMES.PAGE_LOAD)
      await this.takeScreenshot("taskdetails.png")

      // Get ad text for answer matching
      const adText = await this.getAdText()
      this.log(`Ad text: ${adText}`)

      // Handle video with improved logic
      const videoSuccess = await this.handleVideoWithRetry()

      if (!videoSuccess) {
        this.log("Video failed after retries, going back")
        await this.goBackToTaskList()
        return { success: true, message: "Back to list after video failure" }
      }

      // Handle answer submission
      await this.handleAnswerSubmission(adText)

      await this.wait(CONFIG.WAIT_TIMES.PAGE_LOAD)
      await this.takeScreenshot("tasktab.png")

      return { success: true, message: remainingTasksCount > 1 ? "Task done" : "All tasks done" }
    } catch (error) {
      this.log(`Task error: ${error.message}`)
      throw error
    }
  }

  async handleVideoWithRetry() {
    for (let attempt = 0; attempt < CONFIG.VIDEO.RESTART_ATTEMPTS; attempt++) {
      try {
        this.log(`Video attempt ${attempt + 1}/${CONFIG.VIDEO.RESTART_ATTEMPTS}`)

        const success = await this.handleVideo()
        if (success) {
          return true
        }

        if (attempt < CONFIG.VIDEO.RESTART_ATTEMPTS - 1) {
          this.log("Video failed, restarting...")
          await this.restartVideo()
          await this.wait(CONFIG.VIDEO.RESTART_WAIT)
        }
      } catch (error) {
        this.log(`Video attempt ${attempt + 1} failed: ${error.message}`)
        if (attempt === CONFIG.VIDEO.RESTART_ATTEMPTS - 1) {
          return false
        }
      }
    }
    return false
  }

  async handleVideo() {
    // Wait for video element
    const videoExists = await this.page
      .waitForSelector(CONFIG.SELECTORS.TASK.VIDEO, { timeout: 10000 })
      .catch(() => null)
    if (!videoExists) {
      this.log("Video element not found")
      return false
    }

    // Try to play video
    await this.playVideo()

    // Wait for video to start
    const isPlaying = await this.waitForVideoToStart()
    if (!isPlaying) {
      this.log("Video did not start playing")
      return false
    }

    this.log("Video playing")
    await this.takeScreenshot("videoPlaying.png")

    // Watch video with improved monitoring
    return await this.watchVideo()
  }

  async playVideo() {
    // Try clicking play button first
    const playButtonExists = await this.page.$(CONFIG.SELECTORS.TASK.PLAY_BUTTON)
    if (playButtonExists) {
      this.log("Clicking play button")
      await this.page.click(CONFIG.SELECTORS.TASK.PLAY_BUTTON)
      await this.wait(1000)
    }

    // Ensure video is playing programmatically
    await this.page.evaluate(() => {
      const video = document.querySelector("video")
      if (video) {
        video.muted = true
        video.currentTime = 0 // Reset to beginning
        const playPromise = video.play()
        if (playPromise !== undefined) {
          playPromise.catch((e) => console.log("Video play error:", e))
        }
      }
    })
  }

  async waitForVideoToStart() {
    try {
      await this.page.waitForFunction(
        () => {
          const video = document.querySelector("video")
          return video && !video.paused && video.currentTime > 0
        },
        { timeout: 10000 },
      )
      return true
    } catch {
      return false
    }
  }

  async watchVideo() {
    let watchedSeconds = 0
    let stuckCount = 0
    let previousSeconds = 0
    const startTime = Date.now()

    while (watchedSeconds < CONFIG.VIDEO.REQUIRED_SECONDS) {
      if (Date.now() - startTime > CONFIG.VIDEO.MAX_WAIT_TIME) {
        this.log("Video timeout exceeded")
        return false
      }

      // Get watched seconds from UI
      watchedSeconds = await this.page.evaluate(() => {
        const watchedText = Array.from(document.querySelectorAll("p[data-v-1d18d737]")).find((p) =>
          p.textContent.includes("Currently watched"),
        )
        if (watchedText) {
          const match = watchedText.textContent.match(/\d+/)
          return match ? Number.parseInt(match[0]) : 0
        }
        return 0
      })

      this.log(`Watched: ${watchedSeconds}s`)

      // Check if video is stuck
      if (watchedSeconds === previousSeconds) {
        stuckCount++

        // If we're close to completion and stuck, consider it done
        if (watchedSeconds >= 12 && stuckCount > 3) {
          this.log(`Video completed at ${watchedSeconds}s (close enough)`)
          return true
        }

        // If stuck too long, try to restart video
        if (stuckCount >= CONFIG.VIDEO.MAX_STUCK_COUNT) {
          this.log("Video appears stuck, attempting restart")
          await this.restartVideo()
          stuckCount = 0
          await this.wait(2000)
        }
      } else {
        stuckCount = 0
        previousSeconds = watchedSeconds
      }

      if (watchedSeconds >= CONFIG.VIDEO.REQUIRED_SECONDS) {
        this.log("Video watching completed successfully")
        return true
      }

      await this.wait(CONFIG.VIDEO.CHECK_INTERVAL)
    }

    return true
  }

  async restartVideo() {
    try {
      await this.page.evaluate(() => {
        const video = document.querySelector("video")
        if (video) {
          video.pause()
          video.currentTime = 0
          video.muted = true
          setTimeout(() => {
            video.play().catch((e) => console.log("Restart play error:", e))
          }, 500)
        }
      })
      this.log("Video restarted")
    } catch (error) {
      this.log(`Error restarting video: ${error.message}`)
    }
  }

  async getAdText() {
    return await this.page.evaluate(() => {
      const introDiv = Array.from(document.querySelectorAll("div[data-v-1d18d737]")).find(
        (el) => el.textContent.trim() === "Advertising Introduction",
      )
      if (introDiv) {
        const adTextDiv = introDiv.nextElementSibling
        return adTextDiv ? adTextDiv.textContent.trim() : ""
      }
      return ""
    })
  }

  async handleAnswerSubmission(adText) {
    // Click start answering
    await this.page.evaluate(() => {
      const startButton = document.querySelector("button.van-button--danger .van-button__text")
      if (startButton && startButton.textContent.includes("Start Answering")) {
        startButton.closest("button").click()
      }
    })

    await this.wait(2000)
    await this.takeScreenshot("answerOptions.png")

    // Get answers and find correct one
    const answerResult = await this.page.evaluate((adText) => {
      const answers = Array.from(document.querySelectorAll("div[data-v-1d18d737].answer")).map((answer) =>
        answer.textContent.trim(),
      )
      const correctAnswer = answers.find((answer) => adText.toLowerCase().includes(answer.toLowerCase()))
      return { answers, correctAnswer }
    }, adText)

    this.log(`Options: ${answerResult.answers.join(", ")}`)
    this.log(`Answer: ${answerResult.correctAnswer || "No match found"}`)

    if (answerResult.correctAnswer) {
      // Select correct answer
      await this.page.evaluate((correctAnswer) => {
        const answerElement = Array.from(document.querySelectorAll("div[data-v-1d18d737].answer")).find(
          (el) => el.textContent.trim() === correctAnswer,
        )
        if (answerElement) {
          answerElement.click()
        }
      }, answerResult.correctAnswer)

      this.log("Answer selected")
      await this.wait(CONFIG.WAIT_TIMES.ANSWER_BEFORE_SUBMIT)

      // Submit answer
      await this.page.evaluate(() => {
        const submitBtn = Array.from(document.querySelectorAll("button.van-button--danger")).find((button) => {
          const buttonText = button.querySelector(".van-button__text")
          return buttonText && buttonText.textContent.trim() === "Submit Answer"
        })
        if (submitBtn) {
          submitBtn.click()
        }
      })

      this.log("Answer submitted")
      await this.wait(CONFIG.WAIT_TIMES.ANSWER_AFTER_SUBMIT)
      await this.takeScreenshot("afterSubmit.png")

      // Go to next task
      await this.page.evaluate(() => {
        const backBtn = Array.from(document.querySelectorAll("button.van-button--danger")).find((button) => {
          const buttonText = button.querySelector(".van-button__text")
          return buttonText && buttonText.textContent.trim() === "Back to next"
        })
        if (backBtn) {
          backBtn.click()
        }
      })

      this.log("Next task")
    } else {
      this.log("No matching answer found, going back")
      await this.goBackToTaskList()
    }
  }

  async goBackToTaskList() {
    await this.page.goBack({ waitUntil: "networkidle2", timeout: 10000 })
    await this.wait(CONFIG.WAIT_TIMES.PAGE_LOAD)
    this.log("Back to task list")
    await this.takeScreenshot("goBack.png")
  }

  async getRemainingTasksCount() {
    try {
      const remainingTasksText = await this.page.evaluate(() => {
        const taskElement = Array.from(document.querySelectorAll("div[data-v-02e24912]")).find((el) =>
          el.textContent.includes("Tasks remaining today:"),
        )
        return taskElement ? taskElement.textContent.trim() : ""
      })

      const match = remainingTasksText.match(/Tasks remaining today:\s*(\d+)/)
      return match ? Number.parseInt(match[1]) : 0
    } catch (error) {
      this.log(`Error getting remaining tasks count: ${error.message}`)
      return 0
    }
  }

  async handleError(error, phoneNumber, password) {
    if (error.message.includes("Navigation timeout") && this.retryCount < this.maxRetries) {
      this.retryCount++
      this.log(`Retrying automation (attempt ${this.retryCount}/${this.maxRetries})`)

      await this.wait(CONFIG.WAIT_TIMES.RETRY_DELAY * this.retryCount)

      try {
        await this.cleanup()
        await this.initializeBrowser(true)
        await this.performTasks(phoneNumber, password)
        this.log("Retry successful")
        this.emit("completed")
      } catch (retryError) {
        this.log(`Retry failed: ${retryError.message}`)
        this.emit("failed")
      }
    } else {
      this.emit("failed")
    }
  }

  async takeScreenshot(filename) {
    try {
      const screenshotsDir = path.join(__dirname, "screenshots", this.phoneNumber)
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true })
      }

      const fullPath = path.join(screenshotsDir, filename)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }

      await this.page.screenshot({ path: fullPath })
      return true
    } catch (error) {
      this.log(`Failed to take screenshot ${filename}: ${error.message}`)
      return false
    }
  }

  async waitForElement(selector, timeout = 30000) {
    try {
      await this.page.waitForSelector(selector, { visible: true, timeout })
      return true
    } catch (error) {
      this.log(`Element not found ${selector}: ${error.message}`)
      return false
    }
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async cleanup() {
    this.isRunning = false
    if (this.browser) {
      try {
        await this.browser.close()
        this.browser = null
        this.page = null
      } catch (error) {
        this.log(`Error closing browser: ${error.message}`)
      }
    }
  }

  async stop() {
    this.log("Stop command received")
    await this.cleanup()
    this.emit("stopped")
  }
}

// Initialize session manager
const sessionManager = new SessionManager()

// Utility functions
function validatePhoneNumber(phoneNumber) {
  const cleanedNumber = phoneNumber.replace(/\D/g, "")
  const phonePattern = /^[1-9]\d{9}$/

  return {
    isValid: phonePattern.test(cleanedNumber),
    message: phonePattern.test(cleanedNumber)
      ? "Valid phone number"
      : "Invalid phone number format. Must be 10 digits starting with 1-9",
  }
}

async function deleteScreenshotsForPhone(phoneNumber) {
  try {
    const screenshotsDir = path.join(__dirname, "screenshots", phoneNumber)
    if (fs.existsSync(screenshotsDir)) {
      const files = fs.readdirSync(screenshotsDir)
      for (const file of files) {
        const filePath = path.join(screenshotsDir, file)
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath)
        }
      }
      fs.rmdirSync(screenshotsDir)
      console.log(`Deleted screenshots for phone: ${phoneNumber}`)
    }
  } catch (error) {
    console.error(`Error deleting screenshots for phone ${phoneNumber}:`, error)
  }
}

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.post("/start", async (req, res) => {
  const { username, password, headless = true } = req.body

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Phone number and password are required",
    })
  }

  const phoneValidation = validatePhoneNumber(username)
  if (!phoneValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: phoneValidation.message,
    })
  }

  let session = sessionManager.getByPhone(username)
  if (session && session.isRunning) {
    return res.status(400).json({
      success: false,
      message: "You already have an automation running. Please stop the current session before starting a new one.",
    })
  }

  if (!session) {
    session = sessionManager.createSession(username)
  }

  if (sessionManager.activeCount >= CONFIG.MAX_CONCURRENT_SESSIONS) {
    sessionManager.addToQueue(session, username, password, headless)
    res.json({
      success: true,
      message: `Automation queued. Currently ${sessionManager.activeCount} active sessions.`,
      sessionId: session.id,
      queued: true,
    })
  } else {
    sessionManager.startSession(session, username, password, headless)
      .catch(error => {
        // Optionally log error
      });

    res.json({
      success: true,
      message: "Automation started",
      sessionId: session.id,
    });
  }
})

app.get("/logs/phone/:phoneNumber", (req, res) => {
  const session = sessionManager.getByPhone(req.params.phoneNumber)
  if (!session) {
    return res.status(404).json({
      success: false,
      message: "Session not found",
    })
  }
  res.json({
    success: true,
    logs: session.logs || [],
  })
})

app.post("/stop/phone/:phoneNumber", async (req, res) => {
  const session = sessionManager.getByPhone(req.params.phoneNumber)
  if (!session) {
    return res.status(404).json({
      success: false,
      message: "Session not found",
    })
  }

  try {
    await session.stop()
    sessionManager.removeSession(session)
    res.json({
      success: true,
      message: "Automation stopped successfully",
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error stopping automation",
      error: error.message,
    })
  }
})

app.get("/screenshots/:phoneNumber", (req, res) => {
  const phoneNumber = req.params.phoneNumber
  const screenshotsDir = path.join(__dirname, "screenshots", phoneNumber)

  try {
    if (!fs.existsSync(screenshotsDir)) {
      return res.status(404).json({
        success: false,
        message: "No screenshots found for this phone number",
      })
    }

    const files = fs.readdirSync(screenshotsDir)
    const screenshots = files
      .filter((file) => file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".jpeg"))
      .sort((a, b) => {
        const statA = fs.statSync(path.join(screenshotsDir, a))
        const statB = fs.statSync(path.join(screenshotsDir, b))
        return statB.mtime.getTime() - statA.mtime.getTime()
      })

    res.json({
      success: true,
      screenshots,
      message: screenshots.length === 0 ? "No screenshots available yet" : `${screenshots.length} screenshots found`,
    })
  } catch (error) {
    console.error("Error reading screenshots directory:", error)
    res.status(500).json({
      success: false,
      message: "Failed to read screenshots directory. Please try again.",
    })
  }
})

app.delete("/screenshots/:phoneNumber", async (req, res) => {
  const phoneNumber = req.params.phoneNumber
  try {
    await deleteScreenshotsForPhone(phoneNumber)
    res.json({ success: true, message: "Screenshots deleted successfully." })
  } catch (error) {
    console.error("Error deleting screenshots:", error)
    res.status(500).json({ success: false, message: "Failed to delete screenshots." })
  }
})

app.get("/session/status/:phoneNumber", (req, res) => {
  const phoneNumber = req.params.phoneNumber
  const session = sessionManager.getByPhone(phoneNumber)

  if (!session) {
    return res.json({
      success: false,
      isActive: false,
      message: "No session found for this phone number",
    })
  }

  res.json({
    success: true,
    isActive: session.isRunning,
    sessionId: session.id,
    hasLogs: session.logs && session.logs.length > 0,
    logCount: session.logs ? session.logs.length : 0,
  })
})

app.get("/queue/status", (req, res) => {
  res.json({
    activeSessions: sessionManager.activeCount,
    maxConcurrent: CONFIG.MAX_CONCURRENT_SESSIONS,
    queuedSessions: sessionManager.queue.length,
    queue: sessionManager.queue.map((item) => ({
      phoneNumber: item.phoneNumber,
      sessionId: item.session.id,
    })),
  })
})

app.use("/screenshots", express.static(path.join(__dirname, "screenshots")))

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" })
})

// Start server
const PORT = process.env.PORT || 3000
const server = app
  .listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
  })
  .on("error", (error) => {
    console.error(`Server failed to start: ${error}`)
    process.exit(1)
  })

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...")
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})
