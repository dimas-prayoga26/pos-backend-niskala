const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const {
  authorizePusherChannel,
  getRealtimeClientConfig,
} = require("../../infrastructure/realtime/pusher");

const router = express.Router();

// How the frontend listens for changes: Pusher (key, cluster and the private
// channel; all public) or this server's Socket.IO.
router.get("/config", (_req, res) => {
  res.status(200).json({ success: true, data: getRealtimeClientConfig() });
});

// Pusher asks this before letting a device into the private channel: only
// logged-in users (the accessToken cookie) get a signature.
router.post("/pusher/auth", authenticate, (req, res) => {
  const auth = authorizePusherChannel(req.body?.socket_id, req.body?.channel_name);
  if (!auth) {
    res.status(403).json({ success: false, message: "Channel tidak diizinkan." });
    return;
  }

  res.status(200).json(auth);
});

module.exports = router;
