const { chromium } = require('./node_modules/rebrowser-playwright-core');
const fs = require('fs');
const readline = require('readline');

const env = {};
fs.readFileSync('.env','utf8').split('\n').forEach(l => { const m=l.match(/^([^#=]+)=(.*)/); if(m) env[m[1].trim()]=m[2].trim(); });
const COOKIE = env.SUNO_COOKIE;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
      try { const b=JSON.parse(req.postData()); if(b.token) { captchaToken=b.token; console.log('TOKEN_CAPTURED'); } } catch(e) {}
    }
  });
  page.on('response', async resp => {
    if (resp.url().includes('generate/v2') && resp.status()===200) {
      try { genResult = await resp.json(); console.log('GENERATE_OK'); } catch(e) {}
    }
  });

  console.log('Loading page...');
  await page.goto('https://suno.com/create', {waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,6000));

  console.log('Typing and clicking Create...');
  await page.mouse.click(400, 180);
  await new Promise(r=>setTimeout(r,500));
  await page.keyboard.type('A soft jazz ballad about spring rain', {delay:30});
  await new Promise(r=>setTimeout(r,1000));
  const btnCoords = await page.evaluate(() => {
    const b=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.textContent.includes('Create')).pop();
    return b ? {x:b.getBoundingClientRect().x+40,y:b.getBoundingClientRect().y+15} : null;
  });
  if(btnCoords) await page.mouse.click(btnCoords.x, btnCoords.y);

  console.log('Waiting 15s for captcha...');
  await new Promise(r=>setTimeout(r,15000));
  await page.screenshot({path:'captcha-challenge.png'});
  console.log('CAPTCHA_READY');
  
  // Now watch for a command file
  console.log('Watching for command file: .captcha-cmd');
  console.log('Write positions to .captcha-cmd, e.g.: echo "4 5 6" > .captcha-cmd');
  
  // Poll for command file
  while(true) {
    if (fs.existsSync('.captcha-cmd')) {
      const cmd = fs.readFileSync('.captcha-cmd','utf8').trim();
      fs.unlinkSync('.captcha-cmd');
      console.log('Got command: ' + cmd);
      
      if (cmd === 'screenshot') {
        await page.screenshot({path:'captcha-challenge.png'});
        console.log('SCREENSHOT_SAVED');
        continue;
      }
      if (cmd === 'quit') break;
      
      // Parse positions
      const positions = cmd.split(/[\s,]+/).map(Number).filter(n=>n>=1&&n<=9);
      if (positions.length === 0) { console.log('Invalid positions'); continue; }
      
      // Precise coords: iframe at (441,61), cells 120x120 from (10,130) with 130px stride
      const IX = 441, IY = 61;
      
      for (const pos of positions) {
        const row = Math.floor((pos-1)/3);
        const col = (pos-1)%3;
        const x = IX + 10 + col*130 + 60;
        const y = IY + 130 + row*130 + 60;
        console.log('Clicking ' + pos + ' at (' + x + ', ' + y + ')');
        await page.mouse.click(x, y);
        await new Promise(r=>setTimeout(r,800));
      }
      
      await page.screenshot({path:'captcha-after-click.png'});
      console.log('CLICK_DONE - after-click screenshot saved');
      
      // Verify button: iframe(441,61) + button-submit(306,551) center at (348,571)
      await new Promise(r=>setTimeout(r,500));
      
      await page.mouse.click(IX + 348, IY + 571);
      console.log('Clicked verify at (' + (IX+348) + ', ' + (IY+571) + ')');
      
      console.log('Waiting 15s for result...');
      await new Promise(r=>setTimeout(r,15000));
      await page.screenshot({path:'captcha-result.png'});
      
      if (captchaToken) {
        fs.writeFileSync('.captcha-token', captchaToken);
        console.log('SUCCESS_TOKEN_SAVED');
        console.log('Token: ' + captchaToken.substring(0,80));
        break;
      } else if (genResult) {
        console.log('GENERATE_COMPLETED');
        break;
      } else {
        console.log('NO_TOKEN - check captcha-result.png');
        // Don't break - allow retry with new screenshot
        await page.screenshot({path:'captcha-challenge.png'});
        console.log('New screenshot saved. Write new positions to .captcha-cmd');
      }
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
