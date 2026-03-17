const { chromium } = require('./node_modules/rebrowser-playwright-core');
const fs = require('fs');

const env = {};
fs.readFileSync('.env','utf8').split('\n').forEach(l => { const m=l.match(/^([^#=]+)=(.*)/); if(m) env[m[1].trim()]=m[2].trim(); });
const COOKIE = env.SUNO_COOKIE;

const configPath = process.argv[2] || '../music-video-production/batch-output/batch-config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const songs = config.songs;
const STYLE = 'Mellow, slow soft bedtime jazz, french style, mellow female vocal, piano foundation, acoustic guitar bridge and solo, slow waltz';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IX = 441, IY = 61;
const START_FROM = parseInt(process.argv[3] || '0');
let generateSent = false;

async function hasCaptchaChallenge(page) {
  // Check for actual visible captcha challenge, not just the tiny checkbox iframe
  // Method 1: Look for a large hcaptcha challenge iframe (the grid one, not the checkbox)
  const frames = page.frames();
  for (const f of frames) {
    if (f.url().includes('hcaptcha') && f.url().includes('frame=challenge')) return true;
  }
  // Method 2: Check if there's a visible overlay covering the page
  const hasOverlay = await page.evaluate(() => {
    const els = document.querySelectorAll('div[style*="position"]');
    for (const el of els) {
      const s = window.getComputedStyle(el);
      if ((s.position === 'fixed' || s.position === 'absolute') && 
          parseInt(s.zIndex) > 100 && 
          el.offsetWidth > 300 && el.offsetHeight > 300) return true;
    }
    return false;
  }).catch(() => false);
  if (hasOverlay) return true;
  // Method 3: Check for "Choose" or "Select" text typical of hcaptcha challenges
  const hasText = await page.evaluate(() => {
    return document.body.innerText.includes('Please click each image') || 
           document.body.innerText.includes('Choose') ||
           document.body.innerText.includes('Select all');
  }).catch(() => false);
  return hasText;
}

async function captchaScreenshot(page) {
  // Try frame body screenshot
  try {
    const cf = page.frames().find(f => f.url().includes('hcaptcha') && f.url().includes('frame=challenge'));
    if (cf) {
      const body = await cf.$('body');
      if (body) {
        await body.screenshot({ path: 'captcha-challenge.png', timeout: 10000 });
        return true;
      }
    }
  } catch(e) {}
  // Fallback
  try { await page.screenshot({ path: 'captcha-challenge.png' }); } catch(e) {}
  return false;
}

async function detectCaptchaType(page) {
  // Check frame content for drag vs grid type
  try {
    const cf = page.frames().find(f => f.url().includes('hcaptcha') && f.url().includes('frame=challenge'));
    if (cf) {
      const text = await cf.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (text.includes('drag') || text.includes('Drag') || text.includes('piece') || text.includes('fill the empty')) return 'drag';
      if (text.includes('line') || text.includes('ends of')) return 'line';
      if (text.includes('Choose') || text.includes('Select') || text.includes('click each')) return 'grid';
    }
  } catch(e) {}
  return 'unknown';
}

async function solveCaptcha(page) {
  await sleep(3000);
  
  // Detect captcha type
  const captchaType = await detectCaptchaType(page);
  console.log('  Captcha type: ' + captchaType);
  
  if (captchaType === 'drag' || captchaType === 'line') {
    console.log('  ⏭️ Auto-skipping unsupported captcha type (' + captchaType + ')');
    return 'skip';
  }
  
  // Grid type or unknown - screenshot and wait for human
  await captchaScreenshot(page);
  console.log('  CAPTCHA! Write answer to .captcha-cmd');
  
  while (true) {
    if (fs.existsSync('.captcha-cmd')) {
      const cmd = fs.readFileSync('.captcha-cmd', 'utf8').trim();
      fs.unlinkSync('.captcha-cmd');
      if (cmd === 'quit') process.exit(0);
      if (cmd === 'skip') return;
      const positions = cmd.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= 9);
      if (positions.length === 0) continue;
      
      for (const pos of positions) {
        const row = Math.floor((pos - 1) / 3), col = (pos - 1) % 3;
        await page.mouse.click(IX + 10 + col * 130 + 60, IY + 130 + row * 130 + 60);
        await sleep(800);
      }
      await sleep(500);
      await page.mouse.click(IX + 348, IY + 571); // verify
      console.log('  Verify clicked, waiting 15s...');
      await sleep(15000);
      
      // If generate request fired, captcha is solved regardless of frame state
      if (generateSent) {
        console.log('  ✅ Captcha solved (generate request confirmed)!');
        return;
      }
      if (!(await hasCaptchaChallenge(page))) {
        console.log('  ✅ Captcha solved!');
        return;
      }
      // Still captcha - new round, retry screenshot up to 3 times
      let roundCaptured = false;
      for (let retry = 0; retry < 3 && !roundCaptured; retry++) {
        await sleep(3000);
        try {
          const cf = page.frames().find(f => f.url().includes('hcaptcha') && f.url().includes('frame=challenge'));
          if (cf) {
            const body = await cf.$('body');
            if (body) {
              await body.screenshot({ path: 'captcha-challenge.png', timeout: 8000 });
              console.log('  New round - frame body screenshot captured (attempt ' + (retry+1) + ')');
              roundCaptured = true;
            }
          }
        } catch(e) { console.log('  New round attempt ' + (retry+1) + ' failed: ' + e.message.split('\n')[0]); }
      }
      if (!roundCaptured) {
        try {
          await page.screenshot({ path: 'captcha-challenge.png' });
          console.log('  New round - fallback page screenshot (captcha may not be visible)');
        } catch(e) {
          console.log('  New round - all screenshot methods failed, continuing anyway');
        }
      }
    }
    await sleep(1000);
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const cookies = COOKIE.split('; ').map(c => { const [n,...v]=c.split('='); return {name:n,value:v.join('='),domain:'.suno.com',path:'/'}; });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  const remaining = songs.slice(START_FROM);
  console.log('🎵 ' + remaining.length + ' songs (from #' + (START_FROM+1) + ')\n');
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  console.log('Ready.\n');

  // Track generate requests
  page.on('request', req => {
    if (req.url().includes('generate')) {
      generateSent = true;
      console.log('  📡 Generate request sent!');
    }
  });

  let retryCount = 0;
  const MAX_RETRIES = 5;
  for (let i = 0; i < remaining.length; i++) {
    const song = remaining[i];
    const songNum = START_FROM + i + 1;
    console.log('[' + songNum + '/' + songs.length + '] ' + song.title + (retryCount > 0 ? ' (retry ' + retryCount + ')' : ''));

    if (i > 0) await sleep(10000);

    const prompt = STYLE + '. A song called "' + song.title + '". ' + (song.description || song.title);

    // Clear and type
    await page.mouse.click(400, 180, { clickCount: 3 });
    await sleep(100);
    await page.keyboard.press('Control+A');
    await sleep(100);
    await page.keyboard.press('Backspace');
    await sleep(200);
    await page.keyboard.type(prompt, { delay: 5 });
    console.log('  Typed (' + prompt.length + ' chars)');
    await sleep(300);

    // Click Create
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.includes('Create')).pop();
      return b ? { x: b.getBoundingClientRect().x + 40, y: b.getBoundingClientRect().y + 15 } : null;
    });
    if (!btn) { console.log('  ❌ No Create'); continue; }
    generateSent = false;
    await page.mouse.click(btn.x, btn.y);
    console.log('  Create clicked');

    // Wait up to 15s for generate request
    for (let w = 0; w < 15; w++) {
      if (generateSent) break;
      await sleep(1000);
    }

    if (generateSent) {
      retryCount = 0;
      console.log('  ✅ Generation started! Waiting 90s for completion...\n');
      await sleep(90000);
    } else {
      // No generate request — might be captcha or error. Screenshot for debug.
      console.log('  ⚠️ No generate request after 15s — possible captcha');
      await page.screenshot({ path: 'captcha-challenge-full.png' });
      await page.screenshot({ path: 'captcha-challenge.png', clip: { x: 300, y: 0, width: 550, height: 700 } });
      
      // Check for actual challenge iframe
      const hasChallengeFrame = page.frames().some(f => f.url().includes('hcaptcha') && f.url().includes('frame=challenge'));
      if (hasChallengeFrame) {
        console.log('  🔒 Captcha challenge frame found!');
        const result = await solveCaptcha(page);
        if (result === 'skip') {
          // Unsupported captcha type - go back and retry this song
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            console.log('  ❌ Max retries reached, skipping song');
            retryCount = 0;
            continue;
          }
          console.log('  🔄 Reloading page to retry with different captcha... (attempt ' + retryCount + '/' + MAX_RETRIES + ')');
          await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(8000);
          i--; // retry same song
          continue;
        }
        // Grid captcha solved - retry Create
        if (!generateSent) {
          const btn2 = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.includes('Create')).pop();
            return b ? { x: b.getBoundingClientRect().x + 40, y: b.getBoundingClientRect().y + 15 } : null;
          });
          if (btn2) { await page.mouse.click(btn2.x, btn2.y); console.log('  Retry Create'); }
        }
        await sleep(90000);
      } else {
        console.log('  ❓ No captcha frame either — screenshot saved for debug');
        console.log('  Write "skip" to .captcha-cmd to continue, or "quit" to exit');
        // Wait for manual intervention
        while (true) {
          if (fs.existsSync('.captcha-cmd')) {
            const cmd = fs.readFileSync('.captcha-cmd', 'utf8').trim();
            fs.unlinkSync('.captcha-cmd');
            if (cmd === 'quit') process.exit(0);
            if (cmd === 'skip') break;
          }
          await sleep(2000);
        }
      }
    }
  }

  // Wait for all to finish generating
  console.log('⏳ Waiting 3 min for generation...');
  await sleep(180000);

  // Results
  console.log('\n📊 Results:');
  try {
    const jwt = await page.evaluate(async () => {
      const r = await fetch('https://auth.suno.com/v1/client?__clerk_api_version=2021-02-05', { credentials: 'include' });
      return (await r.json()).response.sessions[0].last_active_token.jwt;
    });
    const feed = await page.evaluate(async (jwt) => {
      const r = await fetch('https://studio-api.prod.suno.com/api/feed/v2?page=0', { headers: { 'Authorization': 'Bearer ' + jwt } });
      return r.json();
    }, jwt);
    if (feed.clips) {
      feed.clips.slice(0, 24).forEach(c => console.log('  ' + c.title + ' | ' + c.status + ' | ' + c.id?.substring(0,8)));
      fs.mkdirSync('./batch-output', { recursive: true });
      fs.writeFileSync('./batch-output/batch-results.json', JSON.stringify({
        timestamp: new Date().toISOString(),
        songs: feed.clips.slice(0, 24).map(c => ({ id: c.id, title: c.title, status: c.status, audio_url: c.audio_url }))
      }, null, 2));
      console.log('📁 batch-output/batch-results.json');
    }
  } catch(e) { console.log('  Error: ' + e.message); }

  console.log('\n🎉 DONE - browser open, write "quit" to .captcha-cmd to close');
  while (true) {
    if (fs.existsSync('.captcha-cmd') && fs.readFileSync('.captcha-cmd','utf8').trim() === 'quit') break;
    await sleep(5000);
  }
  await browser.close();
})();
