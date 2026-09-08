const admin = require('firebase-admin');
const User = require('../models/User');
const { initFirebase } = require('./firebaseStorage');

/**
 * Persist inbox notification and deliver FCM push when tokens exist.
 */
async function notifyUser({
  userId,
  type,
  title,
  body,
  actions = [],
  payload = {},
  actor = null,
}) {
  const UserNotification = require('../models/UserNotification');
  const doc = await UserNotification.create({
    userId,
    type,
    title,
    body,
    actions,
    payload,
    actor,
  });

  try {
    initFirebase();
    const user = await User.findById(userId).select('fcmTokens');
    const tokens = (user?.fcmTokens || []).filter(Boolean);
    if (!tokens.length) return doc;

    const message = {
      notification: { title, body },
      data: {
        type: String(type || ''),
        notificationId: String(doc._id),
        ...Object.fromEntries(
          Object.entries(payload || {}).map(([k, v]) => [k, String(v ?? '')]),
        ),
      },
      tokens,
    };

    const result = await admin.messaging().sendEachForMulticast(message);
    if (result.failureCount > 0) {
      const invalid = [];
      result.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code || '';
          if (
            code.includes('registration-token-not-registered') ||
            code.includes('invalid-registration-token')
          ) {
            invalid.push(tokens[i]);
          }
        }
      });
      if (invalid.length) {
        user.fcmTokens = tokens.filter((t) => !invalid.includes(t));
        await user.save();
      }
    }
  } catch (err) {
    console.warn('FCM push skipped:', err.message);
  }

  return doc;
}

module.exports = { notifyUser };
