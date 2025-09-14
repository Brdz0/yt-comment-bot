// server.js (ESM)

// ======== 1. CONFIGURATION (عدّل هنا فقط حسب حاجتك) ========
import express from "express";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import puppeteer from "puppeteer";
import fs from "fs";

const CONFIG = {
  // الرابط العام الذي سيعطيك إياه Railway (سنضيفه لاحقًا)
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  // البورت الذي سيعمل عليه الخادم (Railway يحدده تلقائيًا)
  port: process.env.PORT || 3000,
  // معرفات القنوات التي تريد متابعتها
  channels: [
    "UCneq-pXhApziFpje2tIfofw", // مثال: قناة عبدالله
    // "UC7IRWr5Is8vYuIyq3wUH5xA"  // يمكنك إضافة قنوات أخرى هنا
  ],
  // نص التعليق الذي سيتم نشره
  commentText: `**السلام عليكم أخوي عبدالله,🖐🏼
اتمنى انك تقدر جهودي بكتابة هاذا التعليق,
حاولت اجمعلك كل الالعاب الي تكون قريبه لقلبك وقلبنا وتكون شبيهه ب
(Little Nightmare و Planet of Lana)،
…
لو سمحتو حطوا لايك عشان يوصله ويشوفه 👍**`,
  // كلمة سر للتحقق من أن الإشعار قادم من يوتيوب (سنضبطها لاحقًا)
  verifyToken: process.env.VERIFY_TOKEN || "your-strong-secret-token",
  // إعدادات Puppeteer (البوت)
  puppeteer: {
    headless: process.env.HEADLESS !== "false", // true على الخادم، false محليًا للتسجيل
    userDataDir: "./user_data", // مجلد لحفظ جلسة تسجيل الدخول
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote"
    ]
  }
};
// =================================================================

// ======== 2. APPLICATION STATE (لحفظ بيانات التشغيل) ========
const STATE_FILE = "./app_state.json";
let state = { lastVideoByChannel: {}, subscribedAt: 0 };

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, "utf8");
      state = JSON.parse(data);
      console.log("✅ State loaded successfully.");
    } catch (e) {
      console.warn("⚠️ Could not load state file. Starting fresh.");
    }
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("❌ Could not save state:", e.message);
  }
}

// ======== 3. CORE LOGIC (المنطق الأساسي) ========
const app = express();
let browser;

// دالة لضمان وجود متصفح جاهز
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  console.log("🚀 Launching new Puppeteer browser instance...");
  browser = await puppeteer.launch({
    headless: CONFIG.puppeteer.headless,
    userDataDir: CONFIG.puppeteer.userDataDir,
    args: CONFIG.puppeteer.args
  });
  browser.on('disconnected', () => {
    console.log('Browser disconnected. It will be relaunched on next use.');
    browser = null;
  });
  console.log(`✅ Puppeteer launched (Headless: ${CONFIG.puppeteer.headless})`);
  return browser;
}

// دالة التعليق على الفيديو
async function commentOnVideo(videoUrl) {
  console.log(`▶️ Starting comment process for: ${videoUrl}`);
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => (['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue()));

  try {
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // تحقق من تسجيل الدخول
    const isLoggedIn = !(await page.$('a[href*="accounts.google.com/ServiceLogin"]'));
    if (!isLoggedIn) {
      throw new Error("User not logged in. Please run locally with HEADLESS=false to log in.");
    }

    // التمرير للأسفل لتحميل قسم التعليقات
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForSelector("#comments", { timeout: 15000 });

    // النقر على حقل التعليق
    await page.waitForSelector("#placeholder-area", { timeout: 10000 });
    await page.click("#placeholder-area");

    // كتابة التعليق
    await page.waitForSelector("#contenteditable-root", { timeout: 10000 });
    await page.type("#contenteditable-root", CONFIG.commentText, { delay: 20 });

    // إرسال التعليق
    await page.waitForSelector("#submit-button", { timeout: 10000 });
    await page.click("#submit-button");

    console.log(`✅ Comment posted successfully on: ${videoUrl}`);
  } catch (error) {
    console.error(`❌ Failed to comment on ${videoUrl}:`, error.message);
  } finally {
    await page.close();
  }
}

// دالة الاشتراك في القنوات
async function subscribeAll() {
  if (!CONFIG.publicBaseUrl) {
    console.log("ℹ️ PUBLIC_BASE_URL is not set. Skipping subscriptions (local mode).");
    return;
  }
  console.log("🔄 Starting subscription process for all channels...");
  for (const channelId of CONFIG.channels) {
    const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
    const callbackUrl = `${CONFIG.publicBaseUrl}/websub/callback`;
    
    try {
      await axios.post("https://pubsubhubbub.appspot.com/subscribe", new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.topic": topicUrl,
        "hub.callback": callbackUrl,
        "hub.verify": "async",
        "hub.verify_token": CONFIG.verifyToken,
        "hub.lease_seconds": 864000 // 10 أيام
      }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      console.log(`✔️ Subscription request sent for channel: ${channelId}`);
    } catch (error) {
      console.error(`❌ Subscription failed for ${channelId}:`, error.response?.data || error.message);
    }
  }
  state.subscribedAt = Date.now();
  saveState();
}

// ======== 4. SERVER ROUTES (مسارات الخادم) ========
app.use(express.text({ type: 'application/atom+xml' }));

// مسار التحقق من الصحة
app.get('/health', (_req, res) => res.json({ status: 'ok', state }));
// مسار جديد لتشغيل المتصفح يدويًا لتسجيل الدخول
app.get('/launch-browser-for-login', async (_req, res) => {
  if (CONFIG.puppeteer.headless) {
    return res.status(400).send('This endpoint is only for local login (when HEADLESS=false).');
  }
  try {
    console.log("▶️ Launching browser for login...");
    await getBrowser();
    res.send('✅ Browser launched! Please go to the new browser window, log in to YouTube, then close it. After that, you can stop the server (Ctrl+C).');
  } catch (e) {
    console.error("❌ Failed to launch browser:", e.message);
    res.status(500).send('Failed to launch browser. Check the terminal for errors.');
  }
});

// مسار إعادة الاشتراك اليدوي
app.post('/resub', async (_req, res) => {
  await subscribeAll();
  res.status(200).send('Subscription process initiated.');
});

// مسار اختبار التعليق اليدوي
app.post('/comment', express.json(), async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });
  
  commentOnVideo(`https://www.youtube.com/watch?v=${videoId}`)
    .then(() => res.status(200).json({ message: 'Comment process started.' }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// مسار استقبال إشعارات يوتيوب
const websubRouter = express.Router();
websubRouter.get('/', (req, res) => {
  if (req.query['hub.verify_token'] === CONFIG.verifyToken) {
    res.send(req.query['hub.challenge']);
    console.log("✅ WebSub verification successful!");
  } else {
    res.status(401).send('Invalid token');
    console.warn("⚠️ WebSub verification failed: Invalid token.");
  }
});

websubRouter.post('/', async (req, res) => {
  res.status(204).end(); // رد سريع ليوتيوب لتأكيد الاستلام

  const feed = new XMLParser().parse(req.body);
  const entry = feed?.feed?.entry;
  if (!entry) return;

  const videoId = entry['yt:videoId'];
  const channelId = entry['yt:channelId'];
  const videoTitle = entry.title;

  if (state.lastVideoByChannel[channelId] === videoId) {
    console.log(`- Duplicate notification for video: ${videoId}`);
    return;
  }

  console.log(`📺 New video detected: "${videoTitle}" from channel ${channelId}`);
  state.lastVideoByChannel[channelId] = videoId;
  saveState();

  // تأخير بسيط لضمان أن الفيديو متاح للتعليق
  setTimeout(() => {
    commentOnVideo(`https://www.youtube.com/watch?v=${videoId}`);
  }, 30000); // 30 ثانية
});

app.use('/websub/callback', websubRouter);

// ======== 5. STARTUP & SHUTDOWN (بدء التشغيل والإغلاق) ========
app.listen(CONFIG.port, () => {
  console.log(`🌍 Server listening on port ${CONFIG.port}`);
  loadState();
  // لا تقم بالاشتراك عند بدء التشغيل المحلي، فقط عند النشر
  if (process.env.PUBLIC_BASE_URL) {
    subscribeAll();
    // إعادة الاشتراك تلقائيًا كل 9 أيام
    setInterval(subscribeAll, 9 * 24 * 60 * 60 * 1000);
  }
});

async function gracefulShutdown() {
  console.log("🛑 Shutting down gracefully...");
  saveState();
  if (browser) await browser.close();
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);