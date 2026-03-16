/**
 * Suno Studio API wrapper
 */

const { DEFAULT_UA } = require('./auth');

const BASE_URL = 'https://studio-api.prod.suno.com';

/**
 * Make an authenticated request to the Suno API.
 * @param {string} jwt - JWT token from authenticate()
 * @param {string} endpoint - API path (e.g., '/api/generate/v2/')
 * @param {object|null} body - POST body (null for GET)
 * @param {object} [options]
 * @returns {Promise<{status: number, data: any}>}
 */
async function sunoRequest(jwt, endpoint, body = null, options = {}) {
  const opts = {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'User-Agent': options.userAgent || DEFAULT_UA
    }
  };

  if (body) {
    opts.method = 'POST';
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${BASE_URL}${endpoint}`, opts);
  const text = await resp.text();

  try {
    return { status: resp.status, data: JSON.parse(text) };
  } catch {
    return { status: resp.status, data: text };
  }
}

/**
 * Check if captcha is required for generation.
 * @param {string} jwt
 * @returns {Promise<boolean>}
 */
async function isCaptchaRequired(jwt) {
  const result = await sunoRequest(jwt, '/api/c/check', { ctype: 'generation' });
  return result.data?.required === true;
}

/**
 * Get account billing/credits info.
 * @param {string} jwt
 * @returns {Promise<object>}
 */
async function getCredits(jwt) {
  const result = await sunoRequest(jwt, '/api/billing/info/');
  return result.data;
}

/**
 * Get recent generated songs.
 * @param {string} jwt
 * @param {number} [page=0]
 * @returns {Promise<object[]>}
 */
async function getFeed(jwt, page = 0) {
  const result = await sunoRequest(jwt, `/api/feed/v2?page=${page}`);
  return result.data?.clips || result.data || [];
}

/**
 * Generate music.
 * @param {string} jwt
 * @param {object} params
 * @param {string} params.prompt - Lyrics or description
 * @param {string} [params.tags] - Style/genre tags
 * @param {string} [params.title] - Song title
 * @param {boolean} [params.instrumental=false]
 * @param {string} [params.model='chirp-v4-5'] - Suno model version
 * @param {string|null} [params.captchaToken] - hCaptcha token (required if captcha check returns true)
 * @returns {Promise<{clips: object[]}>}
 */
async function generate(jwt, params) {
  const {
    prompt,
    tags = '',
    title = '',
    instrumental = false,
    model = 'chirp-v4-5',
    captchaToken = null
  } = params;

  const payload = {
    prompt,
    tags,
    title,
    make_instrumental: instrumental,
    mv: model,
    generation_type: 'TEXT',
    token: captchaToken
  };

  const result = await sunoRequest(jwt, '/api/generate/v2/', payload);

  if (result.status !== 200) {
    throw new Error(`Generate failed (${result.status}): ${JSON.stringify(result.data)}`);
  }

  return result.data;
}

/**
 * Poll for song completion.
 * @param {string} jwt
 * @param {string[]} clipIds
 * @param {object} [options]
 * @param {number} [options.timeoutMs=120000]
 * @param {number} [options.pollIntervalMs=5000]
 * @param {function} [options.onProgress] - Called with clips array on each poll
 * @returns {Promise<object[]>}
 */
async function waitForCompletion(jwt, clipIds, options = {}) {
  const {
    timeoutMs = 120000,
    pollIntervalMs = 5000,
    onProgress
  } = options;

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await sunoRequest(jwt, `/api/feed/v2?ids=${clipIds.join(',')}`);
    const clips = Array.isArray(result.data) ? result.data : result.data?.clips || [];

    if (onProgress) onProgress(clips);

    const allDone = clips.every(c =>
      c.status === 'complete' || c.status === 'streaming' || c.status === 'error'
    );

    if (allDone) return clips;

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for generation`);
}

module.exports = {
  sunoRequest,
  isCaptchaRequired,
  getCredits,
  getFeed,
  generate,
  waitForCompletion,
  BASE_URL
};
