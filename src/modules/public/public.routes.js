// External read-only API (best-selling drinks for the website), from any origin, without
// a POS login. Mounted before the POS's own CORS (which only lets the POS
// frontends in), so it carries its own CORS, limit and 404.
const express = require("express");
const cors = require("cors");
const config = require("../../config/env");
const { clientIpOf, createRateLimit } = require("../../shared/middleware/rateLimit");
const { getBestDrinks, requirePublicApiKey } = require("./public.controller");

const router = express.Router();

router.use(
  cors({
    origin: "*",
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    maxAge: 86400,
  })
);

if (config.publicApi.perMinute > 0) {
  router.use(
    createRateLimit({
      windowMs: 60 * 1000,
      max: config.publicApi.perMinute,
      keyOf: (req) => {
        const ip = clientIpOf(req);
        return ip ? `public:${ip}` : "";
      },
      message: (seconds) => `Terlalu banyak permintaan. Coba lagi dalam ${seconds} detik.`,
    })
  );
}

router.use(requirePublicApiKey);

router.get("/best-drinks", getBestDrinks);

router.use((req, res) => {
  res.status(404).json({ status: 404, message: "Endpoint tidak ditemukan." });
});

module.exports = router;
