require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'snap-app-dev-secret-change-me',
  jwtExpiresIn: '7d',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@snapapp.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@123',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/snap_app',
};
