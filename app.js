const express = require("express");
const http = require("http");
const path = require("path");
const { connectDB } = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { initSocket } = require("./config/socket");

const app = express();
const PORT = config.port;
const HOST = config.host;
const isLocalViteOrigin = (origin = "") =>
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):517\d$/.test(origin);
const allowedCorsOrigins = new Set(config.corsOrigins);
const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin || isLocalViteOrigin(origin) || allowedCorsOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({ message: "Hello from POS Server!" });
});

app.use("/api/user", require("./routes/userRoute"));
app.use("/api/order", require("./routes/orderRoute"));
app.use("/api/payment", require("./routes/paymentRoute"));
app.use("/api/category", require("./routes/categoryRoute"));
app.use("/api/menu-item", require("./routes/menuItemRoute"));
app.use("/api/stock-item", require("./routes/stockItemRoute"));
app.use("/api/order-platform", require("./routes/orderPlatformRoute"));
app.use("/api/recap", require("./routes/recapRoute"));

app.use(globalErrorHandler);

const server = http.createServer(app);
initSocket(server, corsOptions);

connectDB()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`POS Server is listening on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(`Database connection failed: ${error.message}`);
    process.exit(1);
  });
