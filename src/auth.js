/**
 * Suno authentication — cookie-based JWT retrieval
 */

const CLERK_URL = 'https://auth.suno.com/v1/client?__clerk_api_version=2021-02-05';
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Get a JWT token from Suno using a browser cookie string.
 * @param {string} cookie - The full cookie string from suno.com
 * @param {object} [options]
 * @param {string} [options.userAgent] - Custom user agent
 * @returns {Promise<{jwt: string, sessionId: string}>}
 */
async function authenticate(cookie, options = {}) {
  const ua = options.userAgent || DEFAULT_UA;

  const resp = await fetch(CLERK_URL, {
    headers: { 'Cookie': cookie, 'User-Agent': ua }
  });

  if (!resp.ok) {
    throw new Error(`Auth failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const sessions = data.response?.sessions;

  if (!sessions?.length) {
    throw new Error('No active Suno session. Cookie may be expired.');
  }

  const session = sessions[0];
  const jwt = session.last_active_token?.jwt;

  if (!jwt) {
    throw new Error('No JWT token in session response.');
  }

  return {
    jwt,
    sessionId: session.id,
    userId: session.user?.id
  };
}

module.exports = { authenticate, CLERK_URL, DEFAULT_UA };
