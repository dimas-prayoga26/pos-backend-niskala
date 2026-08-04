require("dotenv").config();

process.env.TZ = process.env.TZ || "Asia/Jakarta";
const dbTimeZone = /^[-+]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || "")
    ? process.env.DB_TIMEZONE
    : "+07:00";

const config = Object.freeze({
    port: process.env.PORT || 3000,
    host: process.env.HOST || "127.0.0.1",
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
    midtransClientKey: process.env.MIDTRANS_CLIENT_KEY,
    midtransServerKey: process.env.MIDTRANS_SERVER_KEY,
    midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === "true"
});

module.exports = config;
