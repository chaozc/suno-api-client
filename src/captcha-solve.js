const { chromium } = require('./node_modules/rebrowser-playwright-core');
const fs = require('fs');

const env = {};
fs.readFileSync('.env','utf8').split('\n').forEach(l => { const m=l.match(/^([^#=]+)=(.*)/); if(m) env[m[1].trim()]=m[2].trim(); });
const COOKIE = env.SUNO_COOKIE;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Grid positions to click passed as args: node captcha-solve.js 4 8
const positions = process.argv.slice(2).map(Number);
console.log('Will click positions:', positions);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA });
  const cookies = COOKIE.split('; ').map(c => { const [n,...v]=c.split('='); return {name:n,value:v.join('='),domain:'.suno.com',path:'/'}; });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  let captchaToken = null;
  let genResult = null;
  page.on('request', req => {
    if (req.url().includes('generate/v2') && req.postData()) {
      try { const b=JSON.parse(req.postData()); if(b.token) { captchaToken=b.token; console.log('🔑 TOKEN CAPTURED!'); } } catch(e) {}
    }
  });
  page.on('response', async resp => {
    if (resp.url().includes('generate/v2') && resp.status()===200) {
      try { genResult=await resp.json(); console.log('🎵 GENERATE RESPONSE:', JSON.stringify(genResult).substring(0,500)); } catch(e) {}
    }
  });

  console.log('1/6 Loading page...');
  await page.goto('https://suno.com/create', {waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,6000));

  console.log('2/6 Typing description...');
  await page.mouse.click(400, 180);
  await new Promise(r=>setTimeout(r,500));
  await page.keyboard.type('A soft jazz ballad about spring rain', {delay:30});
  await new Promise(r=>setTimeout(r,1000));

  console.log('3/6 Clicking Create...');
  const btnCoords = await page.evaluate(() => {
    const b=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.textContent.includes('Create')).pop();
    return b ? {x:b.getBoundingClientRect().x+40,y:b.getBoundingClientRect().y+15} : null;
  });
  if(btnCoords) await page.mouse.click(btnCoords.x, btnCoords.y);

  console.log('4/6 Waiting for captcha (15s)...');
  await new Promise(r=>setTimeout(r,15000));
  
  // Take screenshot before clicking
  await page.screenshot({path:'captcha-before-solve.png'});
  console.log('Pre-solve screenshot saved');

  console.log('5/6 Clicking captcha cells:', positions.join(', '));
  
  // Find challenge frame iframe position
  const iframeInfo = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('iframe')];
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes('hcaptcha') && iframe.src.includes('frame=che')) {
        const r = iframe.getBoundingClientRect();
        return {x:r.x, y:r.y, w:r.width, h:r.height, src:iframe.src.substring(0,80)};
      }
    }
    // fallback: any hcaptcha iframe
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes('hcaptcha')) {
        const r = iframe.getBoundingClientRect();
        return {x:r.x, y:r.y, w:r.width, h:r.height, src:iframe.src.substring(0,80)};
      }
    }
    return null;
  });
  console.log('Captcha iframe:', JSON.stringify(iframeInfo));

  // Get cells from challenge frame
  let challengeFrame = null;
  for (const f of page.frames()) {
    if (f.url().includes('hcaptcha') && f.url().includes('frame=che')) {
      challengeFrame = f;
      break;
    }
  }

  let clicked = false;
  if (challengeFrame && iframeInfo) {
    const cells = await challengeFrame.evaluate(() => {
      // Try multiple selectors for the image grid
      let els = document.querySelectorAll('.task-image .image');
      if (!els.length) els = document.querySelectorAll('.task-image');
      if (!els.length) els = document.querySelectorAll('[class*="image"]');
      return Array.from(els).map(el => {
        const r = el.getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height};
      });
    }).catch(() => []);
    
    console.log('Cells found in frame:', cells.length);
    if (cells.length > 0) console.log('Cell 1 position:', JSON.stringify(cells[0]));
    
    if (cells.length >= Math.max(...positions)) {
      for (const pos of positions) {
        const cell = cells[pos-1];
        const pageX = iframeInfo.x + cell.x;
        const pageY = iframeInfo.y + cell.y;
        console.log('Clicking cell ' + pos + ' at page (' + Math.round(pageX) + ', ' + Math.round(pageY) + ')');
        await page.mouse.click(pageX, pageY);
        await new Promise(r=>setTimeout(r,600));
      }
      clicked = true;
    }
  }
  
  if (!clicked) {
    console.log('Using estimated grid positions (fallback)');
    // Based on challenge box at ~(451,71) 380x500
    // Grid images start ~150px from top of challenge, each cell ~115px
    const gridX = 470;
    const gridY = 235;
    const cellW = 113;
    const cellH = 113;
    for (const pos of positions) {
      const row = Math.floor((pos-1)/3);
      const col = (pos-1)%3;
      const x = gridX + col*cellW + cellW/2;
      const y = gridY + row*cellH + cellH/2;
      console.log('Clicking cell ' + pos + ' at estimated (' + Math.round(x) + ', ' + Math.round(y) + ')');
      await page.mouse.click(x, y);
      await new Promise(r=>setTimeout(r,600));
    }
  }

  await page.screenshot({path:'captcha-after-click.png'});
  console.log('After-click screenshot saved');

  // Click verify/submit
  console.log('6/6 Clicking Verify...');
  if (challengeFrame) {
    try {
      await challengeFrame.locator('.button-submit').click({timeout:3000});
      console.log('Clicked verify button in frame');
    } catch(e) {
      console.log('Verify button not found in frame, trying alternatives');
      // The verify button is usually at bottom-right of challenge
      if (iframeInfo) {
        const vx = iframeInfo.x + iframeInfo.w - 60;
        const vy = iframeInfo.y + iframeInfo.h - 30;
        await page.mouse.click(vx, vy);
      }
    }
  }

  console.log('Waiting for result (15s)...');
  await new Promise(r=>setTimeout(r,15000));
  await page.screenshot({path:'captcha-result.png'});

  if (captchaToken) {
    fs.writeFileSync('.captcha-token', captchaToken);
    console.log('\\n✅ SUCCESS! Captcha token saved to .captcha-token');
    console.log('Token preview: ' + captchaToken.substring(0,80) + '...');
  } else if (genResult) {
    console.log('\\n✅ Generation completed directly!');
  } else {
    console.log('\\n❌ No token captured. May need to retry with different answers.');
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
