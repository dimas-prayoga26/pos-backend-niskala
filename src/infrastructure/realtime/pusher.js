// Realtime through Pusher Channels (when PUSHER_* is set): the server posts
// each event to Pusher once, and every tablet listens on Pusher's servers
// instead of holding a connection to this one (no Entry Process per device on
// the shared hosting). The channel is private, so a device subscribes only
// after /api/realtime/pusher/auth lets its logged-in user in.
const Pusher = require("pusher");
const config = require("../../config/env");
const logger = require("../../shared/logger");

const { appId, key, secret, cluster, channel } = config.pusher;
const isPusherEnabled = Boolean(appId && key && secret && cluster && channel.startsWith("private-"));

let client;
const getClient = () => {
  if (!isPusherEnabled) return null;
  client ??= new Pusher({ appId, key, secret, cluster, useTLS: true });
  return client;
};

// Fire and forget: a failed post never fails the request that changed data
// (the tablets also refetch on their own every few seconds).
const triggerPusherEvent = (event, payload) => {
  const pusher = getClient();
  // Tests run against a disposable database; their events go nowhere.
  if (!pusher || config.nodeEnv === "test") return;

  pusher.trigger(channel, event, payload).catch((error) => {
    logger.warn("Pusher event not sent", { event, message: error.message });
  });
};

// What the frontend needs to connect (all public; the secret stays here).
const getRealtimeClientConfig = () =>
  isPusherEnabled ? { provider: "pusher", key, cluster, channel } : { provider: "socket.io" };

// Signs a logged-in user's subscription to the POS channel; null for any other.
const authorizePusherChannel = (socketId, channelName) => {
  const pusher = getClient();
  if (!pusher || channelName !== channel || !/^\d+\.\d+$/.test(String(socketId))) return null;

  return pusher.authorizeChannel(String(socketId), channelName);
};

module.exports = { authorizePusherChannel, getRealtimeClientConfig, isPusherEnabled, triggerPusherEvent };
