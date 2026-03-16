/**
 * suno-api-client — Unofficial Suno AI API client
 *
 * Authenticate, generate music, solve captcha, and download tracks.
 *
 * @example
 * const { authenticate, generate, isCaptchaRequired, downloadClips } = require('suno-api-client');
 *
 * const { jwt } = await authenticate(process.env.SUNO_COOKIE);
 * const needsCaptcha = await isCaptchaRequired(jwt);
 * // ... solve captcha if needed ...
 * const result = await generate(jwt, { prompt: 'lyrics...', tags: 'jazz', title: 'My Song' });
 * const clips = await waitForCompletion(jwt, result.clips.map(c => c.id));
 * await downloadClips(clips, './output');
 */

const { authenticate } = require('./auth');
const {
  isCaptchaRequired,
  getCredits,
  getFeed,
  generate,
  waitForCompletion,
  sunoRequest
} = require('./api');
const { solveCaptchaInteractive, HCAPTCHA_SITEKEY } = require('./captcha');
const { downloadFile, downloadClips, saveMetadata } = require('./download');

module.exports = {
  // Auth
  authenticate,

  // API
  isCaptchaRequired,
  getCredits,
  getFeed,
  generate,
  waitForCompletion,
  sunoRequest,

  // Captcha
  solveCaptchaInteractive,
  HCAPTCHA_SITEKEY,

  // Download
  downloadFile,
  downloadClips,
  saveMetadata
};
