const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * PosePing™ — lightweight photo invitation (no live call / no WebRTC).
 * Partner responds without typing: join_now / ten_min / later.
 * After join, both tap "I'm Ready" → both_ready → live capture session.
 */
const posePingSchema = new mongoose.Schema(
  {
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    inviteToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** Live capture session created once both users tap I'm Ready. */
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      index: true,
    },
    /** instant | knock | invite | schedule */
    kind: {
      type: String,
      enum: ['instant', 'knock', 'invite', 'schedule'],
      default: 'instant',
    },
    status: {
      type: String,
      enum: [
        'pending',
        'joining',
        'waiting_ready',
        'both_ready',
        'ready',
        'delayed',
        'later',
        'scheduled',
        'cancelled',
        'expired',
      ],
      default: 'pending',
      index: true,
    },
    response: {
      type: String,
      enum: ['join_now', 'ten_min', 'later', null],
      default: null,
    },
    fromReady: { type: Boolean, default: false },
    toReady: { type: Boolean, default: false },
    /** 10 MIN delay ready-at, or scheduled moment time. */
    readyAt: { type: Date, default: null },
    scheduledAt: { type: Date, default: null },
    scheduleNotified: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

posePingSchema.statics.newInviteToken = function newInviteToken() {
  return crypto.randomBytes(16).toString('hex');
};

module.exports = mongoose.model('PosePing', posePingSchema);
