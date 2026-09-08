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
} = require('../models');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

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
  ]);
}

async function seed({ force = false } = {}) {
  await connectDb();

  const existing = await User.countDocuments();
  if (existing > 0 && !force) {
    console.log(`Database already has ${existing} users. Use --force to reseed.`);
    process.exit(0);
  }

  if (force) {
    await clearAll();
    console.log('Cleared existing collections.');
  }

  const passwordHash = await bcrypt.hash('User@123', 10);
  const adminHash = await bcrypt.hash(config.adminPassword, 10);

  const [admin, alex, jordan, sam, mia, noah, ava] = await User.insertMany([
    {
      email: config.adminEmail,
      passwordHash: adminHash,
      displayName: 'Snap Admin',
      username: 'snapadmin',
      role: 'admin',
      status: 'active',
      verified: true,
      premium: true,
      bio: 'Platform administrator',
      createdAt: daysAgo(90),
      lastActiveAt: new Date(),
    },
    {
      email: 'alex@example.com',
      passwordHash,
      displayName: 'Alex Rivera',
      username: 'alexr',
      role: 'user',
      status: 'active',
      verified: true,
      premium: true,
      bio: 'Capturing moments together',
      createdAt: daysAgo(45),
      lastActiveAt: hoursAgo(1),
    },
    {
      email: 'jordan@example.com',
      passwordHash,
      displayName: 'Jordan Lee',
      username: 'jlee',
      role: 'user',
      status: 'active',
      verified: true,
      premium: false,
      bio: 'Sync snaps everyday',
      createdAt: daysAgo(30),
      lastActiveAt: hoursAgo(3),
    },
    {
      email: 'sam@example.com',
      passwordHash,
      displayName: 'Sam Ortiz',
      username: 'samo',
      role: 'user',
      status: 'suspended',
      verified: false,
      premium: false,
      bio: '',
      createdAt: daysAgo(20),
      lastActiveAt: daysAgo(5),
    },
    {
      email: 'mia@example.com',
      passwordHash,
      displayName: 'Mia Chen',
      username: 'miachen',
      role: 'user',
      status: 'active',
      verified: true,
      premium: true,
      bio: 'Travel + dual snaps',
      createdAt: daysAgo(12),
      lastActiveAt: hoursAgo(8),
    },
    {
      email: 'noah@example.com',
      passwordHash,
      displayName: 'Noah Park',
      username: 'noahp',
      role: 'user',
      status: 'banned',
      verified: false,
      premium: false,
      bio: '',
      createdAt: daysAgo(8),
      lastActiveAt: daysAgo(7),
    },
    {
      email: 'ava@example.com',
      passwordHash,
      displayName: 'Ava Brooks',
      username: 'avab',
      role: 'user',
      status: 'active',
      verified: false,
      premium: false,
      bio: 'New to Snap',
      createdAt: daysAgo(2),
      lastActiveAt: hoursAgo(2),
    },
  ]);

  // Extra dummy users for richer admin lists
  const extraUsers = [];
  for (let i = 1; i <= 12; i += 1) {
    extraUsers.push({
      email: `user${i}@example.com`,
      passwordHash,
      displayName: `Demo User ${i}`,
      username: `demouser${i}`,
      role: 'user',
      status: i % 7 === 0 ? 'suspended' : 'active',
      verified: i % 2 === 0,
      premium: i % 4 === 0,
      bio: `Dummy profile #${i}`,
      createdAt: daysAgo(i),
      lastActiveAt: hoursAgo(i),
    });
  }
  const demos = await User.insertMany(extraUsers);

  const [s1, s2, s3, s4, s5] = await Snap.insertMany([
    {
      ownerId: alex._id,
      partnerId: jordan._id,
      type: 'photo',
      mediaUrl: 'https://picsum.photos/seed/snap1/800/800',
      thumbnailUrl: 'https://picsum.photos/seed/snap1/200/200',
      caption: 'Sunset sync!',
      status: 'published',
      createdAt: daysAgo(3),
    },
    {
      ownerId: mia._id,
      partnerId: alex._id,
      type: 'video',
      mediaUrl: 'https://picsum.photos/seed/snap2/800/800',
      thumbnailUrl: 'https://picsum.photos/seed/snap2/200/200',
      caption: '30s beach walk',
      status: 'published',
      createdAt: daysAgo(2),
    },
    {
      ownerId: ava._id,
      partnerId: jordan._id,
      type: 'photo',
      mediaUrl: 'https://picsum.photos/seed/snap3/800/800',
      thumbnailUrl: 'https://picsum.photos/seed/snap3/200/200',
      caption: 'First dual snap',
      status: 'flagged',
      createdAt: daysAgo(1),
    },
    {
      ownerId: jordan._id,
      partnerId: mia._id,
      type: 'photo',
      mediaUrl: 'https://picsum.photos/seed/snap4/800/800',
      thumbnailUrl: 'https://picsum.photos/seed/snap4/200/200',
      caption: 'Coffee twin',
      status: 'removed',
      createdAt: hoursAgo(20),
    },
    {
      ownerId: demos[0]._id,
      partnerId: alex._id,
      type: 'photo',
      mediaUrl: 'https://picsum.photos/seed/snap5/800/800',
      thumbnailUrl: 'https://picsum.photos/seed/snap5/200/200',
      caption: 'City lights pair',
      status: 'published',
      createdAt: hoursAgo(6),
    },
  ]);

  const [c1, c2, c3] = await Comment.insertMany([
    {
      snapId: s1._id,
      userId: jordan._id,
      text: 'Love this vibe!',
      status: 'visible',
      createdAt: daysAgo(3),
    },
    {
      snapId: s1._id,
      userId: mia._id,
      text: 'Perfect timing',
      status: 'visible',
      createdAt: daysAgo(2),
    },
    {
      snapId: s3._id,
      userId: noah._id,
      text: 'This is inappropriate spam',
      status: 'hidden',
      createdAt: daysAgo(1),
    },
  ]);

  await Report.insertMany([
    {
      targetType: 'snap',
      targetId: s3._id,
      reporterId: alex._id,
      reason: 'Inappropriate content',
      details: 'Contains offensive material',
      status: 'pending',
      createdAt: hoursAgo(18),
    },
    {
      targetType: 'comment',
      targetId: c3._id,
      reporterId: jordan._id,
      reason: 'Harassment',
      details: 'Spam / harassment',
      status: 'pending',
      createdAt: hoursAgo(12),
    },
    {
      targetType: 'snap',
      targetId: s4._id,
      reporterId: mia._id,
      reason: 'Spam',
      details: 'Reposted spam',
      status: 'resolved',
      resolution: 'removed',
      createdAt: daysAgo(1),
      resolvedAt: hoursAgo(10),
    },
  ]);

  await Coupon.insertMany([
    {
      code: 'SNAP20',
      discountPercent: 20,
      active: true,
      maxUses: 100,
      usedCount: 12,
      expiresAt: daysAgo(-30),
      createdAt: daysAgo(40),
    },
    {
      code: 'WELCOME10',
      discountPercent: 10,
      active: true,
      maxUses: 500,
      usedCount: 88,
      expiresAt: daysAgo(-60),
      createdAt: daysAgo(50),
    },
    {
      code: 'EXPIRED50',
      discountPercent: 50,
      active: false,
      maxUses: 50,
      usedCount: 50,
      expiresAt: daysAgo(5),
      createdAt: daysAgo(70),
    },
  ]);

  await Payment.insertMany([
    {
      userId: alex._id,
      amount: 9.99,
      currency: 'USD',
      status: 'completed',
      method: 'card',
      description: 'Premium monthly',
      createdAt: daysAgo(10),
    },
    {
      userId: mia._id,
      amount: 9.99,
      currency: 'USD',
      status: 'completed',
      method: 'card',
      description: 'Premium monthly',
      createdAt: daysAgo(8),
    },
    {
      userId: alex._id,
      amount: 9.99,
      currency: 'USD',
      status: 'refunded',
      method: 'card',
      description: 'Premium monthly — refunded',
      createdAt: daysAgo(40),
      refundedAt: daysAgo(35),
    },
    {
      userId: jordan._id,
      amount: 4.99,
      currency: 'USD',
      status: 'pending',
      method: 'card',
      description: 'Premium trial',
      createdAt: hoursAgo(6),
    },
    {
      userId: demos[3]._id,
      amount: 9.99,
      currency: 'USD',
      status: 'completed',
      method: 'card',
      description: 'Premium monthly',
      createdAt: daysAgo(1),
    },
  ]);

  await Subscription.insertMany([
    {
      userId: alex._id,
      plan: 'premium_monthly',
      status: 'active',
      price: 9.99,
      startedAt: daysAgo(10),
      renewsAt: daysAgo(-20),
    },
    {
      userId: mia._id,
      plan: 'premium_monthly',
      status: 'active',
      price: 9.99,
      startedAt: daysAgo(8),
      renewsAt: daysAgo(-22),
    },
    {
      userId: jordan._id,
      plan: 'premium_monthly',
      status: 'cancelled',
      price: 9.99,
      startedAt: daysAgo(60),
      cancelledAt: daysAgo(15),
    },
  ]);

  await Notification.insertMany([
    {
      title: 'Welcome to Snap',
      body: 'Capture your first dual snap today!',
      audience: 'all',
      type: 'announcement',
      status: 'sent',
      sentAt: daysAgo(20),
    },
    {
      title: 'Weekend Challenge',
      body: 'Sync a sunset photo with a friend — win Premium!',
      audience: 'all',
      type: 'event',
      status: 'sent',
      sentAt: daysAgo(4),
    },
    {
      title: 'Premium tip',
      body: 'Unlock HD dual video with Premium',
      audience: 'premium',
      type: 'push',
      status: 'sent',
      sentAt: daysAgo(1),
    },
  ]);

  await Ticket.insertMany([
    {
      userId: jordan._id,
      subject: 'Cannot connect for dual snap',
      message: 'Partner invite fails after accept.',
      status: 'open',
      priority: 'high',
      createdAt: hoursAgo(9),
      replies: [],
    },
    {
      userId: ava._id,
      subject: 'Verify my account',
      message: 'I submitted ID but still unverified.',
      status: 'open',
      priority: 'medium',
      createdAt: hoursAgo(4),
      replies: [],
    },
    {
      userId: alex._id,
      subject: 'Refund request',
      message: 'Charged twice for Premium.',
      status: 'resolved',
      priority: 'medium',
      createdAt: daysAgo(6),
      replies: [
        {
          authorId: admin._id,
          authorRole: 'admin',
          message: 'Refund processed — sorry for the hassle!',
          createdAt: daysAgo(5),
        },
      ],
    },
  ]);

  console.log('MongoDB seed complete.');
  console.log(`Admin: ${config.adminEmail} / ${config.adminPassword}`);
  console.log('User example: alex@example.com / User@123');
  console.log(`Users: ${await User.countDocuments()} | Snaps: ${await Snap.countDocuments()} | Tickets: ${await Ticket.countDocuments()}`);
  // silence unused refs
  void c1;
  void c2;
  void s2;
  void s5;
  void sam;
  process.exit(0);
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  seed({ force }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed };
