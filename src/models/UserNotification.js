const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema(
  {
    initial: { type: String, default: '?' },
    name: { type: String, default: '' },
  },
  { _id: false },
);

const userNotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'session_started',
        'pair_request',
        'pose_saved',
        'pose_reaction',
        'pose_processed',
        'welcome',
        'admin_push',
        'announcement',
        'event',
        'support_reply',
        'support_status',
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false },
    actions: { type: [String], default: [] },
    payload: {
      sessionId: { type: String, default: null },
      pairRequestId: { type: String, default: null },
      poseId: { type: String, default: null },
      reaction: { type: String, default: null },
    },
    actor: { type: actorSchema, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('UserNotification', userNotificationSchema);
