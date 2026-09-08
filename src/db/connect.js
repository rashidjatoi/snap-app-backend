const mongoose = require('mongoose');
const config = require('../config');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log(`MongoDB connected: ${config.mongoUri}`);
}

module.exports = { connectDb };
