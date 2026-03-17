#!/usr/bin/env node
/**
 * Interactive captcha solver for Suno
 * 1. Launches browser, triggers captcha
 * 2. Screenshots captcha challenge → saves to file
 * 3. Waits for user input via stdin (which images to click)
 * 4. Clicks them, captures token
 * 5. Uses token for batch generation via direct API
 */
const { chromium } = require('./node_modules/rebrowser-playwright-core');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '.env');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const COOKIE = env.SUNO_COOKIE;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJWT() {
  const resp = await fetch('https://auth.suno.com/v1/client?__clerk_api_version=2021-02-05', {
    headers: { 'Cookie': COOKIE, 'User-Agent': UA }
  });
  const data = await resp.json();
  return data.response.sessions[0].last_active_token.jwt;
}

async function main() {
  const action = process.argv[2]; // 'captcha' or 'generate'
  
  if (action === 'generate') {
    // Direct generation with a saved token
    const tokenFile = path.join(__dirname, '.captcha-token');
    if (!fs.existsSync(tokenFile)) {
      console.error('No captcha token saved. Run with "captcha" first.');
      process.exit(1);
    }
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    const jwt = await getJWT();
    
    // Read prompts from stdin or args
    const promptsFile = process.argv[3];
    if (promptsFile) {
      const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
      for (const p of prompts) {
        console.log(`\nGenerating: ${p.title}...`);
        await generateSong(jwt, token, p);
        await sleep(3000); // pause between generations
      }
    }
    return;
  }
  
  // Default: captcha flow
  console.log('🔐 Launching browser to trigger captcha...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({ userAgent: UA });
  const cookies = COOKIE.split('; ').map(c => {
    const [name, ...val] = c.split('=');
    return { name, value: val.join('='), domain: '.suno.com', path: '/' };
  });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // Capture generate request token
  let captchaToken = null;
  page.on('request', req => {
    if (req.url().includes('generate/v2') && req.postData()) {
      try {
        const body = JSON.parse(req.postData());
        if (body.token) {
          captchaToken = body.token;
          console.log('\n✅ Captcha token captured!');
        }
      } catch(e) {}
    }
  });

  let generateResult = null;
  page.on('response', async resp => {
    if (resp.url().includes('generate/v2') && resp.status() === 200) {
      try { generateResult = await resp.json(); } catch(e) {}
    }
  });

  console.log('Loading suno.com/create...');
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);

  // Type description and click Create
  console.log('Typing description and clicking Create...');
  await page.mouse.click(400, 180);
  await sleep(500);
  await page.keyboard.type('A soft jazz ballad about spring rain', { delay: 30 });
  await sleep(500);
  
  const btnCoords = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.includes('Create')).pop();
    return b ? { x: b.getBoundingClientRect().x + 40, y: b.getBoundingClientRect().y + 15 } : null;
  });
  if (btnCoords) await page.mouse.click(btnCoords.x, btnCoords.y);
  
  console.log('Waiting for captcha...');
  await sleep(8000);

  // Check if captcha appeared or generation started
  if (generateResult) {
    console.log('🎉 No captcha needed! Generation started directly.');
    await browser.close();
    return;
  }

  // Screenshot the full page (captcha should be visible as overlay)
  const screenshotPath = path.join(__dirname, 'captcha-challenge.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n📸 Captcha screenshot saved: ${screenshotPath}`);
  console.log('CAPTCHA_READY'); // Signal for the agent

  // Wait for click coordinates via stdin
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const answer = await new Promise(resolve => {
    rl.question('Enter click coordinates as "x1,y1 x2,y2 ..." or image numbers "1 3 7": ', resolve);
  });
  rl.close();

  console.log(`Received answer: ${answer}`);
  
  // Parse answer - could be coordinates or grid positions
  const parts = answer.trim().split(/[\s,]+/);
  
  if (parts[0] === 'skip') {
    // Try clicking Skip button on captcha
    const skipBtn = page.locator('text=Skip').or(page.locator('.button-submit'));
    await skipBtn.click({ force: true, timeout: 3000 }).catch(() => {});
  } else if (parts.every(p => /^\d+$/.test(p) && parseInt(p) <= 9)) {
    // Grid positions (1-9 for 3x3 grid)
    // Need to find the captcha grid and click the right cells
    // The captcha is typically in an iframe
    const frames = page.frames();
    let captchaFrame = null;
    for (const f of frames) {
      if (f.url().includes('hcaptcha') || f.url().includes('captcha')) {
        captchaFrame = f;
        break;
      }
    }
    
    if (captchaFrame) {
      // Get grid cell positions from the captcha frame
      const cells = await captchaFrame.evaluate(() => {
        const taskGrid = document.querySelector('.task-grid, .challenge-container .task-image');
        const images = document.querySelectorAll('.task-image, .image-wrapper, [class*="task"] [class*="image"]');
        return Array.from(images).map(img => {
          const r = img.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
        });
      }).catch(() => []);
      
      console.log(`Found ${cells.length} captcha cells`);
      
      // If we can't find cells in iframe, try clicking based on grid positions on the page
      if (cells.length === 0) {
        // Estimate grid positions based on typical captcha layout
        // Captcha grid is roughly centered on the page
        const pageBox = await page.evaluate(() => {
          const overlay = document.querySelector('[class*="captcha"], [class*="challenge"]');
          if (overlay) {
            const r = overlay.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }
          return null;
        });
        
        // Use page-level coordinates for the grid
        // Typical 3x3 grid in a captcha
        for (const pos of parts.map(Number)) {
          const row = Math.floor((pos - 1) / 3);
          const col = (pos - 1) % 3;
          // Estimate based on typical captcha grid position
          const x = 490 + col * 110 + 55;  // rough estimate
          const y = 280 + row * 110 + 55;
          console.log(`Clicking grid position ${pos} at (${x}, ${y})`);
          await page.mouse.click(x, y);
          await sleep(300);
        }
      } else {
        for (const pos of parts.map(Number)) {
          if (pos > 0 && pos <= cells.length) {
            const cell = cells[pos - 1];
            console.log(`Clicking cell ${pos} at (${cell.x}, ${cell.y})`);
            await page.mouse.click(cell.x, cell.y);
            await sleep(300);
          }
        }
      }
    } else {
      // No iframe found, click on page directly using grid positions
      for (const pos of parts.map(Number)) {
        const row = Math.floor((pos - 1) / 3);
        const col = (pos - 1) % 3;
        const x = 490 + col * 110 + 55;
        const y = 280 + row * 110 + 55;
        console.log(`Clicking position ${pos} at (${x}, ${y})`);
        await page.mouse.click(x, y);
        await sleep(300);
      }
    }

    // Click verify/submit
    await sleep(1000);
    await page.screenshot({ path: path.join(__dirname, 'captcha-after-click.png') });
    
    // Try to find and click submit/verify button
    try {
      const verifyBtn = page.locator('text=Verify').or(page.locator('text=Submit')).or(page.locator('.button-submit'));
      await verifyBtn.click({ force: true, timeout: 3000 });
    } catch(e) {
      // Try clicking in the typical verify button area
      await page.mouse.click(640, 520);
    }
    
    console.log('Submitted answer, waiting for result...');
    await sleep(10000);
  }

  // Check result
  await page.screenshot({ path: path.join(__dirname, 'captcha-result.png') });
  
  if (captchaToken) {
    // Save token for batch generation
    fs.writeFileSync(path.join(__dirname, '.captcha-token'), captchaToken);
    console.log('✅ Token saved to .captcha-token');
    console.log(`Token: ${captchaToken.substring(0, 60)}...`);
  } else if (generateResult) {
    console.log('✅ Generation completed in browser!');
    console.log(JSON.stringify(generateResult, null, 2).substring(0, 500));
  } else {
    console.log('❌ No token captured. Captcha may need another attempt.');
    console.log('Screenshot saved to captcha-result.png');
  }

  await browser.close();
}

async function generateSong(jwt, token, { prompt, tags, title, instrumental = false }) {
  const resp = await fetch('https://studio-api.prod.suno.com/api/generate/v2/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'User-Agent': UA
    },
    body: JSON.stringify({
      prompt, tags, title,
      make_instrumental: instrumental,
      mv: 'chirp-v4-5',
      generation_type: 'TEXT',
      token
    })
  });
  const data = await resp.json();
  if (resp.status !== 200) {
    console.error(`  ❌ Failed: ${JSON.stringify(data)}`);
    return null;
  }
  const clips = data.clips || [];
  clips.forEach(c => console.log(`  🎵 ${c.id}: ${c.title || title}`));
  return data;
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
