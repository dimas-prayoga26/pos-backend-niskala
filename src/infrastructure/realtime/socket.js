const { Server } = require("socket.io");
const logger = require("../../shared/logger");
const { triggerPusherEvent } = require("./pusher");

let io;

const initSocket = (server, corsOptions) => {
  io = new Server(server, {
    cors: corsOptions,
    perMessageDeflate: false,
  });

  io.on("connection", (socket) => {
    logger.info("Realtime client connected", { socketId: socket.id });

    socket.on("disconnect", () => {
      logger.info("Realtime client disconnected", { socketId: socket.id });
    });
  });

  return io;
};

// Sent to the Socket.IO clients of this server and, when configured, to
// Pusher Channels (see ./pusher), so either kind of client hears it.
const emitRealtimeEvent = (event, payload = {}) => {
  const message = {
    ...payload,
    timestamp: new Date().toISOString(),
  };

  triggerPusherEvent(event, message);
  if (!io) return;

  io.emit(event, message);
};

module.exports = { emitRealtimeEvent, initSocket };
