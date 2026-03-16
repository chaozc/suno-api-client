/**
 * Interactive hCaptcha solver for Suno
 *
 * Suno uses hCaptcha Enterprise with custom endpoints.
 * This module launches a headless browser, triggers the captcha,
 * saves a screenshot for human solving, and clicks the indicated cells.
 *
 * Flow:
 *   1. Browser loads suno.com/create with user's cookie
 *   2. Types a prompt and clicks Create to trigger captcha
 *   3. Saves screenshot to a file
 *   4. Watches a command file for the answer (grid positions 1-9)
 *   5. Clicks the cells and submits
 *   6. Captures the captcha token from the generate request
 */

const fs = require('fs');
const path = require('path');

const HCAPTCHA_SITEKEY = 'd65453de-3f1a-4aac-9366-a0f06e52b2ce';
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Parse a cookie string into Playwright cookie objects.
 * @param {string} cookieStr
 * @returns {object[]}
 */
function parseCookies(cookieStr) {
  return cookieStr.split('; ').map(c => {
    const [name, ...val] = c.split('=');
    return { name, value: val.join('='), domain: '.suno.com', path: '/' };
  });
}

/**
 * Launch browser and trigger captcha challenge.
 *
 * @param {object} options
 * @param {string} options.cookie - Suno cookie string
 * @param {string} [options.screenshotPath='./captcha-challenge.png'] - Where to save screenshot
 * @param {string} [options.commandFile='./.captcha-cmd'] - File to watch for click commands
 * @param {string} [options.tokenFile='./.captcha-token'] - Where to save the solved token
 * @param {string} [options.triggerPrompt='A soft jazz ballad about spring rain'] - Text to type to enable Create
 * @param {function} [options.onScreenshot] - Called when screenshot is ready: (path) => {}
 * @param {function} [options.onToken] - Called when token is captured: (token) => {}
 * @param {number} [options.captchaWaitMs=15000] - How long to wait for captcha to appear
 * @param {number} [options.resultWaitMs=15000] - How long to wait after verify
 * @returns {Promise<{token: string|null, generated: object|null}>}
 */
async function solveCaptchaInteractive(options) {
  const {
    cookie,
    screenshotPath = './captcha-challenge.png',
    commandFile = './.captcha-cmd',
    tokenFile = './.captcha-token',
    triggerPrompt = 'A soft jazz ballad about spring rain',
    onScreenshot,
    onToken,
    captchaWaitMs = 15000,
    resultWaitMs = 15000
  } = options;

  // Dynamic import for optional dependency
  let chromium;
  try {
    chromium = require('rebrowser-playwright-core').chromium;
  } catch {
    throw new Error('rebrowser-playwright-core is required. Install it: npm install rebrowser-playwright-core');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  try {
    const ctx = await browser.newContext({ userAgent: DEFAULT_UA });
    await ctx.addCookies(parseCookies(cookie));
    const page = await ctx.newPage();

    // Track captcha token and generate result
    let captchaToken = null;
    let genResult = null;

    page.on('request', req => {
      if (req.url().includes('generate/v2') && req.postData()) {
        try {
          const body = JSON.parse(req.postData());
          if (body.token) captchaToken = body.token;
        } catch {}
      }
    });

    page.on('response', async resp => {
      if (resp.url().includes('generate/v2') && resp.status() === 200) {
        try { genResult = await resp.json(); } catch {}
      }
    });

    // Load page
    await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);

    // Type prompt and click Create
    await page.mouse.click(400, 180);
    await sleep(500);
    await page.keyboard.type(triggerPrompt, { delay: 30 });
    await sleep(1000);

    const btnCoords = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .filter(b => b.offsetParent && b.textContent.includes('Create')).pop();
      return b ? { x: b.getBoundingClientRect().x + 40, y: b.getBoundingClientRect().y + 15 } : null;
    });

    if (btnCoords) await page.mouse.click(btnCoords.x, btnCoords.y);

    // Wait for captcha
    await sleep(captchaWaitMs);

    // If generation already started (no captcha needed)
    if (genResult) {
      return { token: captchaToken, generated: genResult };
    }

    // Save screenshot
    await page.screenshot({ path: screenshotPath });
    if (onScreenshot) onScreenshot(screenshotPath);

    // Remove stale command file
    if (fs.existsSync(commandFile)) fs.unlinkSync(commandFile);

    // Poll for command file
    while (true) {
      if (fs.existsSync(commandFile)) {
        const cmd = fs.readFileSync(commandFile, 'utf8').trim();
        fs.unlinkSync(commandFile);

        if (cmd === 'quit') break;

        if (cmd === 'screenshot') {
          await page.screenshot({ path: screenshotPath });
          if (onScreenshot) onScreenshot(screenshotPath);
          continue;
        }

        // Parse grid positions (1-9)
        const positions = cmd.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= 9);
        if (positions.length === 0) continue;

        // Click captcha grid cells
        // Grid area based on typical hCaptcha layout on Suno
        const gridLeft = 460, gridTop = 185;
        const cellW = (830 - 460) / 3;  // ~123px
        const cellH = (575 - 185) / 3;  // ~130px

        for (const pos of positions) {
          const row = Math.floor((pos - 1) / 3);
          const col = (pos - 1) % 3;
          const x = gridLeft + col * cellW + cellW / 2;
          const y = gridTop + row * cellH + cellH / 2;
          await page.mouse.click(x, y);
          await sleep(600);
        }

        // Click verify button (bottom-right of captcha)
        await sleep(500);
        await page.mouse.click(789, 631);

        // Wait for result
        await sleep(resultWaitMs);

        if (captchaToken) {
          fs.writeFileSync(tokenFile, captchaToken);
          if (onToken) onToken(captchaToken);
          return { token: captchaToken, generated: genResult };
        }

        // Captcha might have failed — take new screenshot for retry
        await page.screenshot({ path: screenshotPath });
        if (onScreenshot) onScreenshot(screenshotPath);
        // Continue loop for another attempt
      }

      await sleep(1000);
    }

    return { token: null, generated: null };
  } finally {
    await browser.close();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  solveCaptchaInteractive,
  HCAPTCHA_SITEKEY,
  parseCookies
};
