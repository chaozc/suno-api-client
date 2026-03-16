/**
 * Download generated tracks from Suno CDN
 */

const fs = require('fs');
const path = require('path');

/**
 * Download a file from a URL.
 * @param {string} url
 * @param {string} outputPath
 * @returns {Promise<{path: string, size: number}>}
 */
async function downloadFile(url, outputPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const buffer = await resp.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  const stats = fs.statSync(outputPath);
  return { path: outputPath, size: stats.size };
}

/**
 * Download completed clips (audio + cover image).
 * @param {object[]} clips - Array of clip objects from Suno API
 * @param {string} outputDir - Directory to save files
 * @param {object} [options]
 * @param {boolean} [options.downloadCover=true] - Also download cover image
 * @param {string} [options.filenamePrefix] - Custom filename prefix (default: date + title)
 * @returns {Promise<object[]>} Array of download results
 */
async function downloadClips(clips, outputDir, options = {}) {
  const { downloadCover = true, filenamePrefix } = options;

  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (const clip of clips) {
    if (clip.status === 'error') {
      results.push({ id: clip.id, error: 'Generation failed' });
      continue;
    }

    const prefix = filenamePrefix ||
      `${new Date().toISOString().split('T')[0]}-${(clip.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const shortId = clip.id.substring(0, 8);

    const result = { id: clip.id, title: clip.title, files: {} };

    // Download audio
    if (clip.audio_url) {
      const audioPath = path.join(outputDir, `${prefix}-${shortId}.mp3`);
      const audio = await downloadFile(clip.audio_url, audioPath);
      result.files.audio = audio;
    }

    // Download cover image
    if (downloadCover && clip.image_url) {
      const ext = clip.image_url.includes('.png') ? 'png' : 'jpeg';
      const imgPath = path.join(outputDir, `${prefix}-${shortId}-cover.${ext}`);
      const img = await downloadFile(clip.image_url, imgPath);
      result.files.cover = img;
    }

    results.push(result);
  }

  return results;
}

/**
 * Save generation metadata as JSON sidecar.
 * @param {object} metadata
 * @param {string} outputPath
 */
function saveMetadata(metadata, outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    provider: 'suno',
    ...metadata
  }, null, 2));
}

module.exports = { downloadFile, downloadClips, saveMetadata };
