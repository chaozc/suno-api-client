#!/usr/bin/env node
/**
 * CLI: Interactive captcha solver for Suno
 *
 * Triggers the hCaptcha challenge, saves a screenshot, and waits for
 * you to write the answer to a command file.
 *
 * Usage:
 *   suno-captcha [--screenshot-path ./captcha.png] [--token-file ./.captcha-token]
 *
 * Environment:
 *   SUNO_COOKIE  - Browser cookie from suno.com (required)
 *
 * Flow:
 *   1. Script saves captcha screenshot
 *   2. You look at the image and write answer: echo "4 5 6" > .captcha-cmd
 *   3. Script clicks the cells and captures the token
 *   4. Token is saved to .captcha-token for use with suno-generate
 */

const { solveCaptchaInteractive } = require('../src');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    screenshotPath: './captcha-challenge.png',
    commandFile: './.captcha-cmd',
    tokenFile: './.captcha-token'
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--screenshot-path': opts.screenshotPath = args[++i]; break;
      case '--command-file': opts.commandFile = args[++i]; break;
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
    process.exit(1);
  }

  console.log('🔐 Suno Captcha Solver\n');
  console.log(`Screenshot will be saved to: ${opts.screenshotPath}`);
  console.log(`Write your answer to: ${opts.commandFile}`);
  console.log(`Token will be saved to: ${opts.tokenFile}\n`);

  const result = await solveCaptchaInteractive({
    cookie,
    screenshotPath: opts.screenshotPath,
    commandFile: opts.commandFile,
    tokenFile: opts.tokenFile,
    onScreenshot: (path) => {
      console.log(`\n📸 Captcha screenshot saved: ${path}`);
      console.log('Look at the image and write your answer:');
      console.log(`  echo "1 3 7" > ${opts.commandFile}`);
      console.log('(Numbers 1-9, left to right, top to bottom)\n');
    },
    onToken: (token) => {
      console.log(`\n✅ Token captured: ${token.substring(0, 60)}...`);
    }
  });

  if (result.token) {
    console.log(`\n🎉 Success! Token saved to ${opts.tokenFile}`);
    console.log('Now run: suno-generate --token-file .captcha-token --prompt "..."');
  } else if (result.generated) {
    console.log('\n🎵 No captcha needed — song generated directly!');
  } else {
    console.log('\n❌ Failed to capture token. Try again.');
    process.exit(1);
  }
})().catch(e => {
  console.error(`\n❌ Error: ${e.message}`);
  process.exit(1);
});
