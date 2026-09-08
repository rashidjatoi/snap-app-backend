const { getApp } = require('../src/app');

// Vercel serverless entry — Express app with MongoDB
module.exports = async (req, res) => {
  const app = await getApp();
  return app(req, res);
};
