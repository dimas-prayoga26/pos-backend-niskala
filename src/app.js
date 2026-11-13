const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const config = require("./config/env");
const { corsOptions } = require("./config/cors");
const { UPLOADS_DIR } = require("./config/paths");
const errorHandler = require("./shared/middleware/errorHandler");
const { clientIpOf, createRateLimit } = require("./shared/middleware/rateLimit");
const { isSocketIoEnabled } = require("./infrastructure/realtime/socket");
const { getLocalAccessUrls } = require("./shared/utils/networkAddresses");

const createApp = () => {
  const app = express();

  app.use(cors(corsOptions));
  // Tablets still on an old page keep polling Socket.IO: answered at once
  // (their client waits a few seconds before trying again).
  if (!isSocketIoEnabled) {
    app.use("/socket.io", (req, res) => res.status(410).end());
  }
  // A device that loops on the API (a stuck page, a script) is held back;
  // the cafe's tablets share one address, so the limit is generous.
  if (config.rateLimit.apiPerMinute > 0) {
    app.use(
      "/api",
      createRateLimit({
        windowMs: 60 * 1000,
        max: config.rateLimit.apiPerMinute,
        keyOf: (req) => {
          const ip = clientIpOf(req);
          return ip ? `api:${ip}` : "";
        },
        message: (seconds) => `Terlalu banyak permintaan. Coba lagi dalam ${seconds} detik.`,
      })
    );
  }
  app.use(express.json());
  app.use(cookieParser());
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.get("/", (req, res) => {
    res.json({ message: "Hello from POS Server!" });
  });

  if (config.nodeEnv === "development") {
    app.get("/api/network-info", (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(getLocalAccessUrls());
    });
  }

  app.use("/api/user", require("./modules/users/user.routes"));
  app.use("/api/order", require("./modules/orders/order.routes"));
  app.use("/api/category", require("./modules/categories/category.routes"));
  app.use("/api/menu-item", require("./modules/menu/menu.routes"));
  app.use("/api/stock-item", require("./modules/stock/stock.routes"));
  app.use("/api/shopping", require("./modules/shopping/shopping.routes"));
  app.use("/api/order-platform", require("./modules/platforms/platform.routes"));
  app.use("/api/payment-source", require("./modules/paymentSources/paymentSource.routes"));
  app.use("/api/recap", require("./modules/recaps/recap.routes"));
  app.use("/api/realtime", require("./modules/realtime/realtime.routes"));

  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
