const http = require('http');
const config = require('./config');
const { getApp } = require('./app');
const { attachSocketSignaling } = require('./realtime/socketSignaling');

async function bootstrap() {
  const app = await getApp();
  const server = http.createServer(app);
  const { broadcast } = attachSocketSignaling(server);

  // Mirror Socket.IO broadcasts when REST signal endpoints are used.
  try {
    const sessionRoutes = require('./routes/sessions');
    if (typeof sessionRoutes.setSignalBroadcast === 'function') {
      sessionRoutes.setSignalBroadcast(broadcast);
    }
  } catch (err) {
    console.warn('Could not wire signal broadcast:', err.message);
  }

  server.listen(config.port, () => {
    console.log(`Snap API running on http://localhost:${config.port}`);
    console.log(`WebRTC signaling: Socket.IO + REST /sessions/:id/signal`);
    console.log(`MongoDB: ${config.mongoUri}`);
    console.log(`Admin: ${config.adminEmail} / ${config.adminPassword}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
