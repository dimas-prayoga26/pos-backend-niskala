const http = require("http");
const config = require("./config/env");
const { corsOptions } = require("./config/cors");
const { bootstrapDatabase } = require("./infrastructure/database/bootstrap");
const { pool } = require("./infrastructure/database/pool");
const { startDayClosing } = require("./modules/recaps/dayClosing");
const { initSocket } = require("./infrastructure/realtime/socket");
const logger = require("./shared/logger");
const { printLocalAccessUrls } = require("./shared/utils/networkAddresses");
const { createApp } = require("./app");

// Boot order: build the app, attach Socket.IO, run startup migrations, listen.
const start = () => {
  if (!config.accessTokenSecret) {
    logger.warn("JWT_SECRET is not set: logins will fail until it is configured.");
  }

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server, corsOptions);

  return bootstrapDatabase()
    .then(() => {
      server.listen(config.port, config.host, () => {
        logger.info(`POS Server is listening on http://${config.host}:${config.port}`);
        if (config.nodeEnv === "development") printLocalAccessUrls();
      });
      // Closes each business day at 05:00 the next morning (Rekap New saves
      // nothing). Tests close days themselves.
      if (config.nodeEnv !== "test") startDayClosing(pool);
    })
    .catch((error) => {
      logger.error(`Database connection failed: ${error.message}`, { stack: error.stack });
      process.exit(1);
    });
};

module.exports = { start };
