const mongoose = require('mongoose');

const linkedAccountSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    connected: { type: Boolean, default: false },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    avatarUrl: { type: String, default: null },
    avatarColor: { type: String, default: '#FF6B35' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
    verified: { type: Boolean, default: false },
    premium: { type: Boolean, default: false },
    bio: { type: String, default: '' },
    isGuest: { type: Boolean, default: false },
    onlineStatus: { type: Boolean, default: true },
    preferences: {
      darkMode: { type: Boolean, default: false },
      notificationsEnabled: { type: Boolean, default: true },
    },
    privacy: {
      cameraAccess: { type: Boolean, default: true },
      microphoneAccess: { type: Boolean, default: true },
      locationAccess: { type: Boolean, default: false },
      showOnlineStatus: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
      whoCanPair: {
        type: String,
        enum: ['everyone', 'friends_only', 'nobody'],
        default: 'friends_only',
      },
      whoCanSeePoses: {
        type: String,
        enum: ['everyone', 'partners_only', 'only_me'],
        default: 'only_me',
      },
      analyticsAndCrashReports: { type: Boolean, default: false },
    },
    linkedAccounts: {
      type: [linkedAccountSchema],
      default: () => [
        { provider: 'instagram', connected: false },
        { provider: 'whatsapp', connected: false },
      ],
    },
    resetToken: { type: String, default: null },
    resetTokenExpiresAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName,
    fullName: this.displayName,
    username: this.username,
    avatarUrl: this.avatarUrl,
    avatarColor: this.avatarColor,
    role: this.role,
    status: this.status,
    verified: this.verified,
    premium: this.premium,
    bio: this.bio,
    isGuest: this.isGuest,
    onlineStatus: this.onlineStatus,
    preferences: {
      darkMode: this.preferences?.darkMode ?? false,
      notificationsEnabled: this.preferences?.notificationsEnabled ?? true,
    },
    privacy: {
      cameraAccess: this.privacy?.cameraAccess ?? true,
      microphoneAccess: this.privacy?.microphoneAccess ?? true,
      locationAccess: this.privacy?.locationAccess ?? false,
      showOnlineStatus: this.privacy?.showOnlineStatus ?? true,
      readReceipts: this.privacy?.readReceipts ?? true,
      whoCanPair: this.privacy?.whoCanPair ?? 'friends_only',
      whoCanSeePoses: this.privacy?.whoCanSeePoses ?? 'only_me',
      analyticsAndCrashReports: this.privacy?.analyticsAndCrashReports ?? false,
    },
    linkedAccounts: (this.linkedAccounts || []).map((a) => ({
      provider: a.provider,
      connected: a.connected,
    })),
    createdAt: this.createdAt,
    lastActiveAt: this.lastActiveAt,
  };
};

module.exports = mongoose.model('User', userSchema);
