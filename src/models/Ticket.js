const mongoose = require('mongoose');

const replySchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: { type: String, enum: ['user', 'admin'], required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ticketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    category: {
      type: String,
      enum: ['complaint', 'feedback', 'bug', 'other'],
      default: 'complaint',
    },
    status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    replies: [replySchema],
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

ticketSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    userId: this.userId?.toString?.() || this.userId,
    subject: this.subject,
    message: this.message,
    category: this.category || 'complaint',
    status: this.status,
    priority: this.priority,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    replies: (this.replies || []).map((r) => ({
      id: r._id.toString(),
      authorId: r.authorId?.toString?.() || r.authorId,
      authorRole: r.authorRole,
      message: r.message,
      createdAt: r.createdAt,
    })),
  };
};

module.exports = mongoose.model('Ticket', ticketSchema);
