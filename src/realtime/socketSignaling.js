const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const config = require('../config');
const { User, Session } = require('../models');

/**
 * Optional Socket.IO signaling for long-running Node hosts.
 * Vercel serverless cannot keep WS open — Flutter falls back to REST poll.
 */
function attachSocketSignaling(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error('Unauthorized'));
      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join', async ({ sessionId, signalingToken } = {}, ack) => {
      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          if (ack) ack({ ok: false, error: 'SESSION_NOT_FOUND' });
          return;
        }
        const uid = socket.userId;
        const isHost = String(session.hostId) === uid;
        const isGuest = session.guestId && String(session.guestId) === uid;
        if (!isHost && !isGuest) {
          if (ack) ack({ ok: false, error: 'FORBIDDEN' });
          return;
        }
        if (
          signalingToken &&
          session.signalingToken &&
          signalingToken !== session.signalingToken
        ) {
          if (ack) ack({ ok: false, error: 'INVALID_TOKEN' });
          return;
        }

        socket.sessionId = sessionId;
        socket.join(`session:${sessionId}`);
        socket.to(`session:${sessionId}`).emit('signal', {
          type: 'peer.joined',
          sessionId,
          fromUserId: uid,
          payload: {},
          createdAt: new Date().toISOString(),
        });
        if (ack) {
          ack({
            ok: true,
            hostId: session.hostId.toString(),
            guestId: session.guestId ? session.guestId.toString() : null,
            isHost,
          });
        }
      } catch (err) {
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('signal', async (msg = {}) => {
      try {
        const sessionId = msg.sessionId || socket.sessionId;
        if (!sessionId) return;
        const session = await Session.findById(sessionId);
        if (!session) return;

        const type = String(msg.type || '');
        const fromUserId = socket.userId;
        const signal = {
          signalId: `sig_${Date.now().toString(36)}`,
          type,
          fromUserId,
          payload: msg.payload || {},
          createdAt: new Date(),
        };
        session.signals = [...(session.signals || []), signal].slice(-200);
        if (type === 'peer.ready') {
          const ready = new Set(session.readyUserIds || []);
          ready.add(fromUserId);
          session.readyUserIds = [...ready];
          if (['paired', 'ready_to_pair'].includes(session.status)) {
            session.status = 'live';
          }
        }
        await session.save();

        socket.to(`session:${sessionId}`).emit('signal', {
          ...signal,
          sessionId,
          createdAt: signal.createdAt.toISOString(),
        });
      } catch (err) {
        console.error('socket signal error', err);
      }
    });

    socket.on('disconnect', () => {
      if (!socket.sessionId) return;
      socket.to(`session:${socket.sessionId}`).emit('signal', {
        type: 'peer.disconnected',
        sessionId: socket.sessionId,
        fromUserId: socket.userId,
        payload: {},
        createdAt: new Date().toISOString(),
      });
    });
  });

  function broadcast(sessionId, message, exceptUserId) {
    const room = io.sockets.adapter.rooms.get(`session:${sessionId}`);
    if (!room) return;
    for (const sid of room) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      if (exceptUserId && s.userId === exceptUserId) continue;
      s.emit('signal', message);
    }
  }

  return { io, broadcast };
}

module.exports = { attachSocketSignaling };
