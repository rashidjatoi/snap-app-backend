const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    audience: { type: String, enum: ['all', 'premium'], default: 'all' },
    type: { type: String, enum: ['push', 'announcement', 'event'], default: 'push' },
    status: { type: String, enum: ['draft', 'sent'], default: 'sent' },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

notificationSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    title: this.title,
    body: this.body,
    audience: this.audience,
    type: this.type,
    status: this.status,
    sentAt: this.sentAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Notification', notificationSchema);
