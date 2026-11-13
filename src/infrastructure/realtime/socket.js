const { Server } = require("socket.io");
const config = require("../../config/env");
const logger = require("../../shared/logger");
const { isPusherEnabled, triggerPusherEvent } = require("./pusher");

let io;

// Socket.IO is off while Pusher carries realtime: a device polling it holds an
// Entry Process of the shared hosting, and too many of them make the hosting
// answer 508 to everything. REALTIME_SOCKET_IO=on|off overrides this.
const isSocketIoEnabled =
  config.realtimeSocketIo === "on" || (config.realtimeSocketIo !== "off" && !isPusherEnabled);

const initSocket = (server, corsOptions) => {
  if (!isSocketIoEnabled) {
    logger.info("Socket.IO off: realtime goes through Pusher");
    return null;
  }

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

module.exports = { emitRealtimeEvent, initSocket, isSocketIoEnabled };
