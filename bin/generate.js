#!/usr/bin/env node
/**
 * CLI: Generate music on Suno
 *
 * Usage:
 *   suno-generate --prompt "lyrics..." --tags "jazz, mellow" --title "My Song"
 *
 * Environment:
 *   SUNO_COOKIE  - Browser cookie from suno.com (required)
 *
 * Options:
 *   --prompt        Lyrics or description (required)
 *   --tags          Style/genre tags
 *   --title         Song title
 *   --instrumental  Generate instrumental only
 *   --model         Suno model (default: chirp-v4-5)
 *   --output-dir    Download directory (default: ./output)
 *   --no-wait       Don't wait for completion
 *   --no-download   Don't download files
 *   --token         Provide captcha token directly
 *   --token-file    Read captcha token from file
 */

const { authenticate, isCaptchaRequired, generate, waitForCompletion, downloadClips, saveMetadata } = require('../src');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    prompt: '', tags: '', title: '', instrumental: false,
    model: 'chirp-v4-5', outputDir: './output',
    wait: true, download: true, token: null, tokenFile: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt': opts.prompt = args[++i]; break;
      case '--tags': opts.tags = args[++i]; break;
      case '--title': opts.title = args[++i]; break;
      case '--instrumental': opts.instrumental = true; break;
      case '--model': opts.model = args[++i]; break;
      case '--output-dir': opts.outputDir = args[++i]; break;
      case '--no-wait': opts.wait = false; break;
      case '--no-download': opts.download = false; break;
      case '--token': opts.token = args[++i]; break;
      case '--token-file': opts.tokenFile = args[++i]; break;
    }
  }

  return opts;
}

(async () => {
  const opts = parseArgs();
  const cookie = process.env.SUNO_COOKIE;

  if (!cookie) {
    console.error('Error: SUNO_COOKIE environment variable is required.');
    console.error('Set it to your browser cookie from suno.com');
    process.exit(1);
  }

  if (!opts.prompt) {
    console.error('Error: --prompt is required.');
    process.exit(1);
  }

  console.log('🎵 Suno Music Generator\n');

  // Authenticate
  console.log('Authenticating...');
  const { jwt } = await authenticate(cookie);
  console.log('  ✅ Authenticated\n');

  // Check captcha
  console.log('Checking captcha...');
  const needsCaptcha = await isCaptchaRequired(jwt);
  console.log(`  Captcha required: ${needsCaptcha}\n`);

  let captchaToken = opts.token;
  if (!captchaToken && opts.tokenFile && fs.existsSync(opts.tokenFile)) {
    captchaToken = fs.readFileSync(opts.tokenFile, 'utf8').trim();
  }

  if (needsCaptcha && !captchaToken) {
    console.error('Captcha is required but no token provided.');
    console.error('Run `suno-captcha` first to solve captcha and get a token.');
    process.exit(1);
  }

  // Generate
  console.log(`Generating: "${opts.title || 'Untitled'}"...`);
  const result = await generate(jwt, {
    prompt: opts.prompt,
    tags: opts.tags,
    title: opts.title,
    instrumental: opts.instrumental,
    model: opts.model,
    captchaToken
  });

  const clips = result.clips || [];
  console.log(`  ✅ ${clips.length} tracks queued`);
  clips.forEach(c => console.log(`    - ${c.id}: ${c.title || 'Untitled'} (${c.status})`));

  if (!opts.wait || clips.length === 0) {
    console.log('\nDone (not waiting for completion).');
    return;
  }

  // Wait
  console.log('\nWaiting for generation...');
  const completed = await waitForCompletion(jwt, clips.map(c => c.id), {
    onProgress: (clips) => {
      const statuses = clips.map(c => `${c.title}: ${c.status}`).join(', ');
      process.stdout.write(`  ${statuses}\r`);
    }
  });
  console.log('\n  ✅ Generation complete\n');

  if (!opts.download) {
    console.log('Done (skipping download).');
    return;
  }

  // Download
  console.log('Downloading...');
  const downloads = await downloadClips(completed, opts.outputDir);
  for (const dl of downloads) {
    if (dl.error) {
      console.log(`  ❌ ${dl.id}: ${dl.error}`);
    } else if (dl.files.audio) {
      const sizeMB = (dl.files.audio.size / 1024 / 1024).toFixed(1);
      console.log(`  ✅ ${path.basename(dl.files.audio.path)} (${sizeMB} MB)`);
    }
  }

  // Save metadata
  const metaPath = path.join(opts.outputDir, `${new Date().toISOString().split('T')[0]}-${(opts.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-meta.json`);
  saveMetadata({
    prompt: opts.prompt, tags: opts.tags, title: opts.title,
    instrumental: opts.instrumental, model: opts.model,
    tracks: completed.map(c => ({
      id: c.id, title: c.title, status: c.status,
      duration: c.metadata?.duration,
      audio_url: c.audio_url, image_url: c.image_url
    }))
  }, metaPath);

  console.log(`\n🎉 Done! Files in ${opts.outputDir}`);
})().catch(e => {
  console.error(`\n❌ Error: ${e.message}`);
  process.exit(1);
});
