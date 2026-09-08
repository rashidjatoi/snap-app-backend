function ok(res, data, meta) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

function fail(res, status, message, code) {
  const body = { success: false, message };
  if (code) {
    body.error = { code, message };
  }
  return res.status(status).json(body);
}

module.exports = { ok, fail };
