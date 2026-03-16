# suno-api-client

Unofficial Node.js client for [Suno AI](https://suno.com) — generate music programmatically.

Suno doesn't offer a public API. This client uses cookie-based authentication and handles hCaptcha challenges interactively, so you can automate music generation from scripts, pipelines, or AI agents.

## Features

- 🔑 **Cookie-based auth** — JWT retrieval via Clerk
- 🎵 **Generate music** — custom lyrics, style tags, instrumental mode
- 🔐 **Interactive captcha** — triggers hCaptcha, screenshots for human solving, clicks cells
- 📥 **Download** — audio files + cover images + metadata
- ⏳ **Poll for completion** — waits for generation with progress callbacks
- 💳 **Account info** — check credits/billing

## Quick Start

```bash
npm install suno-api-client

# For captcha solving (optional, only needed if your IP triggers captcha)
npx playwright install chromium
```

### As a library

```javascript
const { authenticate, isCaptchaRequired, generate, waitForCompletion, downloadClips } = require('suno-api-client');

// 1. Authenticate with your Suno cookie
const { jwt } = await authenticate(process.env.SUNO_COOKIE);

// 2. Check if captcha is needed
const needsCaptcha = await isCaptchaRequired(jwt);
// If yes, run the captcha solver first (see below)

// 3. Generate
const result = await generate(jwt, {
  prompt: 'Verse 1:\nRaindrops on the windowpane...',
  tags: 'jazz, mellow female vocal, piano, slow waltz',
  title: 'Rain in Spring',
  captchaToken: token // from captcha solver, or null if not needed
});

// 4. Wait for completion
const clips = await waitForCompletion(jwt, result.clips.map(c => c.id), {
  onProgress: (clips) => console.log(clips.map(c => `${c.title}: ${c.status}`))
});

// 5. Download
await downloadClips(clips, './output');
```

### CLI

```bash
# Set your cookie
export SUNO_COOKIE="your_cookie_string_from_browser"

# Solve captcha (if needed — datacenter IPs usually require this)
npx suno-captcha
# → Opens browser, saves screenshot, you tell it which images to click

# Generate a song
npx suno-generate \
  --prompt "A rainy day in Paris, coffee and jazz" \
  --tags "mellow jazz, french, female vocal, piano" \
  --title "Café Rain" \
  --token-file .captcha-token \
  --output-dir ./songs
```

## Getting Your Cookie

1. Open [suno.com](https://suno.com) in your browser and log in
2. Open DevTools → Application → Cookies → `suno.com`
3. Copy all cookies as a single string (name=value pairs separated by `; `)
4. Set as `SUNO_COOKIE` environment variable

> ⚠️ Cookies expire periodically. You'll need to refresh them when auth fails.

## Captcha Solving

Suno uses hCaptcha Enterprise to prevent automation. The captcha solver works interactively:

1. **Script** launches a headless browser, types a prompt, clicks Create
2. **Script** saves a screenshot of the captcha challenge
3. **You** look at the screenshot and write which cells to click: `echo "4 5 6" > .captcha-cmd`
4. **Script** clicks the cells, submits, and captures the token

The token is saved to `.captcha-token` and can be used with `suno-generate --token-file`.

**When is captcha triggered?**
- Datacenter/VPS IPs → almost always
- Home/residential IPs → rarely or never
- If your home IP doesn't trigger captcha, you don't need the captcha solver at all

## API Reference

### `authenticate(cookie, options?)`
Returns `{ jwt, sessionId, userId }`.

### `isCaptchaRequired(jwt)`
Returns `boolean`.

### `generate(jwt, params)`
Params: `{ prompt, tags?, title?, instrumental?, model?, captchaToken? }`
Returns `{ clips: [{ id, title, status }] }`.

### `waitForCompletion(jwt, clipIds, options?)`
Options: `{ timeoutMs?, pollIntervalMs?, onProgress? }`
Returns completed clip objects with `audio_url`, `image_url`, `metadata`.

### `downloadClips(clips, outputDir, options?)`
Options: `{ downloadCover?, filenamePrefix? }`
Downloads audio + cover images.

### `getCredits(jwt)`
Returns billing/credits info.

### `getFeed(jwt, page?)`
Returns recent generated songs.

### `solveCaptchaInteractive(options)`
Options: `{ cookie, screenshotPath?, commandFile?, tokenFile?, onScreenshot?, onToken? }`
Returns `{ token, generated }`.

## Disclaimer

This is an **unofficial** client. Suno does not provide a public API, and automated access may violate their Terms of Service. Use responsibly and at your own risk.

## License

MIT
