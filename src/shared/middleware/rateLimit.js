// Request limits kept in memory (the hosting runs one Node process): a fixed
// window per key, answered with 429 and Retry-After once it is used up.

// The device's address. The web server in front of Node (LiteSpeed/Passenger
// on the hosting) writes the last X-Forwarded-For entry, so a client cannot
// fake it; without the header, the socket's address. A loopback address is the
// local proxy, not a device: "" (unknown).
const clientIpOf = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const ip = forwarded.length ? forwarded[forwarded.length - 1] : req.socket?.remoteAddress || "";

  return /^(127\.|::1$|::ffff:127\.)/.test(ip) ? "" : ip;
};

// keyOf(req): the bucket of a request; "" lets it through uncounted.
// countFailuresOnly: a request answered below 400 gives its hit back (logins:
// only wrong passwords count).
const createRateLimit = ({ windowMs, max, keyOf, message, countFailuresOnly = false }) => {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    hits.forEach((entry, key) => {
      if (entry.resetAt <= now) hits.delete(key);
    });
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const key = keyOf(req);
    if (!key) {
      next();
      return;
    }

    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ success: false, message: message(retryAfterSeconds) });
      return;
    }

    entry.count += 1;
    if (countFailuresOnly) {
      res.on("finish", () => {
        if (res.statusCode < 400) entry.count = Math.max(entry.count - 1, 0);
      });
    }
    next();
  };
};

module.exports = { clientIpOf, createRateLimit };
