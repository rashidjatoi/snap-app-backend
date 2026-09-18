const mongoose = require('mongoose');

/**
 * Directed friend request / accepted friendship.
 * Canonical pair key is sorted user ids so we never store duplicates.
 */
const friendshipSchema = new mongoose.Schema(
  {
    userA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Who initiated the request (equals userA or userB). */
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true },
);

friendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });

friendshipSchema.statics.orderedPair = function orderedPair(id1, id2) {
  const a = String(id1);
  const b = String(id2);
  return a < b
    ? { userA: id1, userB: id2 }
    : { userA: id2, userB: id1 };
};

module.exports = mongoose.model('Friendship', friendshipSchema);
