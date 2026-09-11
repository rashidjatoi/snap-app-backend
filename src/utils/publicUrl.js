/**
 * Absolute origin used in shared pose links (must be reachable by recipients).
 * Prefer PUBLIC_SHARE_BASE_URL; fall back to the deployed API.
 */
function publicShareBase(req) {
  const fromEnv = (
    process.env.PUBLIC_SHARE_BASE_URL ||
    process.env.APP_PUBLIC_URL ||
    ''
  ).trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (process.env.VERCEL_URL) {
    return `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, '')}`;
  }

  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(
      req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4000',
    )
      .split(',')[0]
      .trim();
    if (host) return `${proto}://${host}`;
  }

  return 'https://snap-app-backend.vercel.app';
}

function poseShareUrl(poseId, req) {
  return `${publicShareBase(req)}/p/${encodeURIComponent(poseId)}`;
}

function isDeadPlaceholderShareUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return /holdpose\.app/i.test(url);
}

module.exports = {
  publicShareBase,
  poseShareUrl,
  isDeadPlaceholderShareUrl,
};
