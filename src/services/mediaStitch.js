const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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

function resizeToWidth(img, targetW) {
  const scale = targetW / img.width;
  const h = Math.max(1, Math.round(img.height * scale));
  img.resize({ w: targetW, h });
  return img;
}

/**
 * Top/bottom (feed-style) composite of two peer photos → Firebase URL.
 * Matches the live capture split: host on top, guest below.
 */
async function stitchPhotosTopBottom({ hostUrl, guestUrl, userId }) {
  const [hostBuf, guestBuf] = await Promise.all([
    fetchBuffer(hostUrl),
    fetchBuffer(guestUrl),
  ]);

  const hostImg = await Jimp.read(hostBuf);
  const guestImg = await Jimp.read(guestBuf);

  const targetW = Math.min(hostImg.width, guestImg.width, 1080);
  resizeToWidth(hostImg, targetW);
  resizeToWidth(guestImg, targetW);

  const width = targetW;
  const height = hostImg.height + guestImg.height;
  const canvas = new Jimp({ width, height, color: 0x000000ff });
  canvas.composite(hostImg, 0, 0);
  canvas.composite(guestImg, 0, hostImg.height);

  const out = await canvas.getBuffer('image/jpeg');
  const uploaded = await uploadBuffer(out, {
    folder: 'poses',
    filename: `stitched_${Date.now()}.jpg`,
    contentType: 'image/jpeg',
    userId: userId || 'system',
  });
  return uploaded.url;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        // Drop the huge build banner so the real error is visible.
        const useful = stderr
          .split('\n')
          .filter((line) => !/configuration:|--enable-/.test(line))
          .join('\n')
          .trim();
        reject(new Error(`ffmpeg exited ${code}: ${(useful || stderr).slice(-1200)}`));
      }
    });
  });
}

async function writeTemp(buffer, ext) {
  const file = path.join(
    os.tmpdir(),
    `holdpose_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`,
  );
  await fs.promises.writeFile(file, buffer);
  return file;
}

/**
 * WebRTC MediaRecorder often writes incomplete / nonstandard containers that
 * ExoPlayer rejects (NoDeclaredBrand). Re-encode to a plain H.264 MP4.
 */
async function normalizeToMp4(inputBuf) {
  if (!inputBuf || !inputBuf.length) {
    throw new Error('Empty video buffer');
  }
  // Probe by trying common extensions — recorder may be webm labeled as mp4.
  const attempts = ['mp4', 'webm', 'mkv', '3gp'];
  let lastErr;
  for (const ext of attempts) {
    const inPath = await writeTemp(inputBuf, ext);
    const outPath = path.join(
      os.tmpdir(),
      `holdpose_norm_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
    );
    try {
      await runFfmpeg([
        '-y',
        '-i',
        inPath,
        '-map',
        '0:v:0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-map',
        '0:a?',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        outPath,
      ]);
      const outBuf = await fs.promises.readFile(outPath);
      if (!outBuf.length) throw new Error('normalize produced empty mp4');
      return outBuf;
    } catch (err) {
      lastErr = err;
    } finally {
      await Promise.all([
        fs.promises.unlink(inPath).catch(() => {}),
        fs.promises.unlink(outPath).catch(() => {}),
      ]);
    }
  }
  throw lastErr || new Error('normalizeToMp4 failed');
}

/**
 * Top/bottom stacked dual video (host top, guest bottom), synced to shortest.
 * Produces one playable/shareable mp4 — same layout as photo stitch / live feed.
 */
async function stitchVideosTopBottom({ hostUrl, guestUrl, userId }) {
  const [hostRaw, guestRaw] = await Promise.all([
    fetchBuffer(hostUrl),
    fetchBuffer(guestUrl),
  ]);

  // Always normalize — peer recorders rarely produce ExoPlayer-safe mp4s.
  const [hostBuf, guestBuf] = await Promise.all([
    normalizeToMp4(hostRaw),
    normalizeToMp4(guestRaw),
  ]);

  const hostPath = await writeTemp(hostBuf, 'mp4');
  const guestPath = await writeTemp(guestBuf, 'mp4');
  const outPath = path.join(
    os.tmpdir(),
    `holdpose_out_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
  );

  try {
    const filter =
      '[0:v]scale=720:-2:force_original_aspect_ratio=decrease,setsar=1,fps=24[top];' +
      '[1:v]scale=720:-2:force_original_aspect_ratio=decrease,setsar=1,fps=24[bot];' +
      '[top][bot]vstack=inputs=2[v]';

    await runFfmpeg([
      '-y',
      '-i',
      hostPath,
      '-i',
      guestPath,
      '-filter_complex',
      filter,
      '-map',
      '[v]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-shortest',
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const outBuf = await fs.promises.readFile(outPath);
    if (!outBuf.length) {
      throw new Error('ffmpeg produced empty video');
    }

    const uploaded = await uploadBuffer(outBuf, {
      folder: 'poses',
      filename: `stitched_${Date.now()}.mp4`,
      contentType: 'video/mp4',
      userId: userId || 'system',
    });
    return uploaded.url;
  } finally {
    await Promise.all([
      fs.promises.unlink(hostPath).catch(() => {}),
      fs.promises.unlink(guestPath).catch(() => {}),
      fs.promises.unlink(outPath).catch(() => {}),
    ]);
  }
}

async function framesToMp4(frameBuffers, { fps = 4 } = {}) {
  if (!frameBuffers?.length) {
    throw new Error('No frames to encode');
  }
  // Keep only real PNG frames (reject empty/corrupt grabs).
  const valid = frameBuffers.filter(
    (b) => Buffer.isBuffer(b) && b.length > 64 && b[0] === 0x89 && b[1] === 0x50,
  );
  if (valid.length < 2) {
    throw new Error(
      `Need at least 2 valid PNG frames (got ${valid.length}/${frameBuffers.length})`,
    );
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'holdpose_frames_'));
  const outPath = path.join(dir, 'out.mp4');
  try {
    for (let i = 0; i < valid.length; i++) {
      const name = path.join(dir, `frame_${String(i).padStart(4, '0')}.png`);
      await fs.promises.writeFile(name, valid[i]);
    }
    await runFfmpeg([
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(dir, 'frame_%04d.png'),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath,
    ]);
    const outBuf = await fs.promises.readFile(outPath);
    if (!outBuf.length) throw new Error('framesToMp4 produced empty video');
    return outBuf;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** @deprecated Use stitchPhotosTopBottom — kept for older callers. */
async function stitchPhotosSideBySide(args) {
  return stitchPhotosTopBottom(args);
}

module.exports = {
  stitchPhotosTopBottom,
  stitchPhotosSideBySide,
  stitchVideosTopBottom,
  normalizeToMp4,
  framesToMp4,
  fetchBuffer,
};
