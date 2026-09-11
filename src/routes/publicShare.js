const express = require('express');
const { Pose } = require('../models');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Public pose page — no auth. Shared WhatsApp / Stories / Copy Link land here.
 */
router.get('/:poseId', async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose || !pose.mediaUrl) {
      res.status(404).type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Pose not found · HoldPose</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
background:#0c0c0e;color:#f5f5f7}
.card{max-width:360px;padding:28px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#a0a0a6;margin:0}
</style></head><body><div class="card">
<h1>Pose not found</h1>
<p>This shared pose may have been removed.</p>
</div></body></html>`);
      return;
    }

    const title = escapeHtml(pose.partnersLabel || 'Shared Pose');
    const media = escapeHtml(pose.mediaUrl);
    const thumb = escapeHtml(pose.thumbnailUrl || pose.mediaUrl);
    const isVideo = pose.mediaType === 'video';
    const created = pose.createdAt
      ? new Date(pose.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · HoldPose</title>
<meta property="og:title" content="${title} · HoldPose"/>
<meta property="og:description" content="Two places. One perfect pose."/>
<meta property="og:image" content="${thumb}"/>
<meta property="og:type" content="${isVideo ? 'video.other' : 'website'}"/>
<meta name="twitter:card" content="summary_large_image"/>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: "SF Pro Display", system-ui, -apple-system, sans-serif;
    background: #0c0c0e;
    color: #f5f5f7;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 16px 40px;
  }
  .brand {
    font-weight: 800;
    letter-spacing: -0.02em;
    margin-bottom: 20px;
    background: linear-gradient(90deg,#FF6B35,#7B2FF7);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-size: 1.35rem;
  }
  .frame {
    width: min(100%, 420px);
    border-radius: 20px;
    overflow: hidden;
    background: #1c1c1f;
    box-shadow: 0 18px 50px rgba(255,45,123,0.18);
  }
  .frame img, .frame video {
    display: block;
    width: 100%;
    height: auto;
    vertical-align: middle;
    background: #111;
  }
  .meta {
    width: min(100%, 420px);
    margin-top: 18px;
    text-align: center;
  }
  .meta h1 { margin: 0 0 6px; font-size: 1.35rem; }
  .meta p { margin: 0; color: #a0a0a6; font-size: 0.95rem; }
  .cta {
    margin-top: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px 22px;
    border-radius: 999px;
    text-decoration: none;
    color: #fff;
    font-weight: 700;
    background: linear-gradient(90deg,#FF6B35,#7B2FF7);
  }
</style>
</head>
<body>
  <div class="brand">HoldPose</div>
  <div class="frame">
    ${
      isVideo
        ? `<video src="${media}" poster="${thumb}" controls playsinline></video>`
        : `<img src="${media}" alt="${title}"/>`
    }
  </div>
  <div class="meta">
    <h1>${title}</h1>
    <p>${escapeHtml(created)}</p>
  </div>
  <a class="cta" href="${media}" target="_blank" rel="noopener">Open media</a>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).type('text').send('Share page failed');
  }
});

module.exports = router;
