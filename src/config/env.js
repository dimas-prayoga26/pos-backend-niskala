require("dotenv").config();

process.env.TZ = process.env.TZ || "Asia/Jakarta";
const dbTimeZone = /^[-+]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || "")
    ? process.env.DB_TIMEZONE
    : "+07:00";

const config = Object.freeze({
    port: process.env.PORT || 8080,
    host: process.env.HOST || "0.0.0.0",
    dbHost: process.env.DB_HOST || "localhost",
    dbPort: Number(process.env.DB_PORT) || 3306,
    dbUser: process.env.DB_USER || "root",
    dbPassword: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "pos_system",
    dbTimeZone,
    appTimeZone: process.env.TZ,
    nodeEnv : process.env.NODE_ENV || "development",
    corsOrigins: (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    accessTokenSecret: process.env.JWT_SECRET,
    // Realtime through Pusher Channels when set (else Socket.IO on this server).
    pusher: Object.freeze({
        appId: process.env.PUSHER_APP_ID || "",
        key: process.env.PUSHER_KEY || "",
        secret: process.env.PUSHER_SECRET || "",
        cluster: process.env.PUSHER_CLUSTER || "",
        // A private channel: only logged-in users are let in.
        channel: process.env.PUSHER_CHANNEL || "private-pos",
    }),
});

module.exports = config;
