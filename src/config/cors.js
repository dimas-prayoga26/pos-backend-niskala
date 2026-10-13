const config = require("./env");

// Local and private-LAN Vite dev servers (ports 5170-5179) are always allowed
// so tablets on the same Wi-Fi can reach the API; others come from CORS_ORIGINS.
const isLocalViteOrigin = (origin = "") =>
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):517\d$/.test(origin);
const isPrivateLanViteOrigin = (origin = "") =>
  /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):517\d$/.test(
    origin
  );
const allowedCorsOrigins = new Set(config.corsOrigins);

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (
      !origin ||
      isLocalViteOrigin(origin) ||
      isPrivateLanViteOrigin(origin) ||
      allowedCorsOrigins.has(origin)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
};

module.exports = { corsOptions };
