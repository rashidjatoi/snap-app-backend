const express = require('express');
const { PosePing, User } = require('../models');
const { publicShareBase } = require('../utils/publicUrl');

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
 * Public PosePing invite landing — WhatsApp / SMS one-tap link.
 * Deep-links into the app when installed; otherwise shows download CTA.
 */
router.get('/:token', async (req, res) => {
  try {
    const ping = await PosePing.findOne({ inviteToken: req.params.token });
    if (!ping || ping.status === 'expired' || ping.expiresAt < new Date()) {
      res.status(404).type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invite expired · HoldPose</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
background:#0c0c0e;color:#f5f5f7}
.card{max-width:360px;padding:28px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#a0a0a6;margin:0}
</style></head><body><div class="card">
<h1>Invite expired</h1>
<p>Ask your friend to send a fresh PosePing.</p>
</div></body></html>`);
      return;
    }

    const from = await User.findById(ping.fromUserId);
    const name = escapeHtml(from?.displayName || 'A friend');
    const deepLink = `holdpose://poseping/${ping._id.toString()}`;
    const base = publicShareBase(req);
    const openUrl = escapeHtml(deepLink);

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PosePing · HoldPose</title>
<meta property="og:title" content="📸 ${name} wants to HoldPose with you!"/>
<meta property="og:description" content="PosePing™ — Tap. Join. Pose. Together."/>
<meta property="og:type" content="website"/>
<style>
:root{--bg:#0c0c0e;--fg:#f5f5f7;--muted:#a0a0a6;--accent:#ff5a7a;--card:#16161a}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:ui-rounded,system-ui,sans-serif;
background:radial-gradient(1200px 600px at 50% -10%,#3a1520 0%,var(--bg) 55%);
color:var(--fg);display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:400px;background:var(--card);border-radius:24px;padding:28px 24px;
border:1px solid rgba(255,255,255,.06);text-align:center}
.badge{display:inline-block;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;
color:var(--accent);margin-bottom:12px;font-weight:700}
h1{font-size:1.45rem;line-height:1.25;margin:0 0 10px}
p{color:var(--muted);margin:0 0 22px;line-height:1.45}
.cta{display:block;width:100%;padding:14px 16px;border-radius:14px;border:0;
background:linear-gradient(135deg,#ff7a45,#ff5a7a);color:#fff;font-weight:700;
font-size:1rem;text-decoration:none;margin-bottom:10px}
.sub{font-size:.85rem;color:var(--muted)}
</style>
</head>
<body>
<div class="card">
  <div class="badge">PosePing™</div>
  <h1>📸 ${name} wants to HoldPose with you!</h1>
  <p>Tap. Join. Pose. Together.<br/>Open HoldPose to respond without typing.</p>
  <a class="cta" href="${openUrl}">JOIN NOW in HoldPose</a>
  <p class="sub">Don't have the app? Install HoldPose, then open this link again.<br/>
  <a href="${escapeHtml(base)}" style="color:var(--accent)">holdpose</a></p>
</div>
<script>
  setTimeout(function(){ try{ window.location.href = ${JSON.stringify(deepLink)}; }catch(e){} }, 400);
</script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).type('html').send('Invite error');
  }
});

module.exports = router;
