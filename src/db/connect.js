const mongoose = require('mongoose');
const config = require('../config');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log(`MongoDB connected: ${config.mongoUri}`);

  // Repair sparse unique firebaseUid: null values break email/guest signup.
  try {
    const col = mongoose.connection.collection('users');
    const result = await col.updateMany(
      { $or: [{ firebaseUid: null }, { firebaseUid: '' }] },
      { $unset: { firebaseUid: '' } },
    );
    if (result.modifiedCount) {
      console.log(`Cleared null firebaseUid on ${result.modifiedCount} users`);
    }
  } catch (err) {
    console.warn('firebaseUid cleanup skipped:', err.message);
  }
}

module.exports = { connectDb };
