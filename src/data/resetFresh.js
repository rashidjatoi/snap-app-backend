/**
 * Wipe all app collections and create a fresh admin account only.
 * Usage: node src/data/resetFresh.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDb } = require('../db/connect');
const config = require('../config');
const {
  User,
  Snap,
  Comment,
  Report,
  Payment,
  Coupon,
  Subscription,
  Notification,
  Ticket,
  Session,
  StitchJob,
  Pose,
  PairRequest,
  UserNotification,
  Friendship,
  PosePing,
} = require('../models');

async function clearAll() {
  await Promise.all([
    User.deleteMany({}),
    Snap.deleteMany({}),
    Comment.deleteMany({}),
    Report.deleteMany({}),
    Payment.deleteMany({}),
    Coupon.deleteMany({}),
    Subscription.deleteMany({}),
    Notification.deleteMany({}),
    Ticket.deleteMany({}),
    Session.deleteMany({}),
    StitchJob.deleteMany({}),
    Pose.deleteMany({}),
    PairRequest.deleteMany({}),
    UserNotification.deleteMany({}),
    Friendship.deleteMany({}),
    PosePing.deleteMany({}),
  ]);
}

async function main() {
  await connectDb();
  console.log('Wiping all collections…');
  await clearAll();

  const adminHash = await bcrypt.hash(config.adminPassword, 10);
  const admin = await User.create({
    email: config.adminEmail,
    passwordHash: adminHash,
    displayName: 'Snap Admin',
    username: 'snapadmin',
    role: 'admin',
    status: 'active',
    verified: true,
    premium: true,
    bio: 'Platform administrator',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const counts = {
    users: await User.countDocuments(),
    snaps: await Snap.countDocuments(),
    sessions: await Session.countDocuments(),
    friends: await Friendship.countDocuments(),
    posePings: await PosePing.countDocuments(),
  };

  console.log('Database reset complete.');
  console.log(`Admin: ${admin.email} (password from ADMIN_PASSWORD env)`);
  console.log('Counts:', counts);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
