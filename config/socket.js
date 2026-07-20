const { Server } = require("socket.io");

let io;

const initSocket = (server, corsOptions) => {
  io = new Server(server, {
    cors: corsOptions,
  });

  io.on("connection", (socket) => {
    console.log(`Realtime client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`Realtime client disconnected: ${socket.id}`);
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
