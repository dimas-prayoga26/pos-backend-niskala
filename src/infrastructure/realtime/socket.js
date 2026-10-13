const { Server } = require("socket.io");
const logger = require("../../shared/logger");

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

const emitRealtimeEvent = (event, payload = {}) => {
  if (!io) return;

  io.emit(event, {
    ...payload,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { emitRealtimeEvent, initSocket };
