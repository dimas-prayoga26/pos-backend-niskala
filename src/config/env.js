require("dotenv").config();

process.env.TZ = process.env.TZ || "Asia/Jakarta";
const dbTimeZone = /^[-+]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || "")
    ? process.env.DB_TIMEZONE
    : "+07:00";

// A whole number from the environment, or the fallback when unset or invalid.
const numberFromEnv = (name, fallback) => {
    const value = Number(process.env[name]);
    return process.env[name] !== undefined && process.env[name] !== "" && Number.isInteger(value) && value >= 0
        ? value
        : fallback;
};

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
    // Socket.IO on this server: "on" or "off"; unset, it is off while Pusher
    // carries realtime (each polling device holds an Entry Process).
    realtimeSocketIo: process.env.REALTIME_SOCKET_IO || "",
    // Requests to /api per device a minute, and wrong passwords per account
    // and device in 15 minutes (0: no limit).
    // Konsumsi Crew (order type Crew) opens at this hour, Jakarta time.
    crewMealStartHour: numberFromEnv("CREW_MEAL_START_HOUR", 12),
    rateLimit: Object.freeze({
        apiPerMinute: numberFromEnv("RATE_LIMIT_API_PER_MINUTE", 1000),
        loginFailures: numberFromEnv("RATE_LIMIT_LOGIN_FAILURES", 10),
    }),
});

module.exports = config;
