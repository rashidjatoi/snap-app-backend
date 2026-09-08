const config = require('./config');
const { getApp } = require('./app');

async function bootstrap() {
  const app = await getApp();
  app.listen(config.port, () => {
    console.log(`Snap API running on http://localhost:${config.port}`);
    console.log(`MongoDB: ${config.mongoUri}`);
    console.log(`Admin: ${config.adminEmail} / ${config.adminPassword}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
