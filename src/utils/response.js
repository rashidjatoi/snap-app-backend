function ok(res, data, meta) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

module.exports = { ok, fail };
