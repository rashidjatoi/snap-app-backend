const https = require('https');
const http = require('http');
const { Jimp } = require('jimp');
const { uploadBuffer } = require('./firebaseStorage');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchBuffer(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download media (${res.statusCode})`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function resizeToHeight(img, targetH) {
  const scale = targetH / img.height;
  const w = Math.max(1, Math.round(img.width * scale));
  img.resize({ w, h: targetH });
  return img;
}

/**
 * Side-by-side (split_screen) composite of two peer photos → Firebase URL.
 */
async function stitchPhotosSideBySide({ hostUrl, guestUrl, userId }) {
  const [hostBuf, guestBuf] = await Promise.all([
    fetchBuffer(hostUrl),
    fetchBuffer(guestUrl),
  ]);

  const hostImg = await Jimp.read(hostBuf);
  const guestImg = await Jimp.read(guestBuf);

  const targetH = Math.min(hostImg.height, guestImg.height, 1280);
  resizeToHeight(hostImg, targetH);
  resizeToHeight(guestImg, targetH);

  const width = hostImg.width + guestImg.width;
  const height = Math.max(hostImg.height, guestImg.height);
  const canvas = new Jimp({ width, height, color: 0x000000ff });
  canvas.composite(hostImg, 0, 0);
  canvas.composite(guestImg, hostImg.width, 0);

  const out = await canvas.getBuffer('image/jpeg');
  const uploaded = await uploadBuffer(out, {
    folder: 'poses',
    filename: `stitched_${Date.now()}.jpg`,
    contentType: 'image/jpeg',
    userId: userId || 'system',
  });
  return uploaded.url;
}

module.exports = { stitchPhotosSideBySide, fetchBuffer };
