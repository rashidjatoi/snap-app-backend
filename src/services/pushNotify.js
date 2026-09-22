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
    if (!tokens.length) {
      console.warn(
        `FCM skipped: no device tokens for user ${userId} (type=${type})`,
      );
      return doc;
    }

    const data = {
      type: String(type || ''),
      title: String(title || ''),
      body: String(body || ''),
      notificationId: String(doc._id),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      ...Object.fromEntries(
        Object.entries(payload || {}).map(([k, v]) => [k, String(v ?? '')]),
      ),
    };

    const message = {
      tokens,
      notification: {
        title: String(title || 'HoldPose'),
        body: String(body || ''),
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'holdpose_push',
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: 'high',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const result = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `FCM ${type} → user ${userId}: success=${result.successCount} failure=${result.failureCount}`,
    );

    if (result.failureCount > 0) {
      const invalid = [];
      result.responses.forEach((r, i) => {
        if (!r.success) {
          console.warn(
            `FCM token failed [${i}]: ${r.error?.code || ''} ${r.error?.message || ''}`,
          );
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
