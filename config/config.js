require("dotenv").config();

const config = Object.freeze({
    port: process.env.PORT || 3000,
    dbHost: process.env.DB_HOST || "localhost",
    dbPort: Number(process.env.DB_PORT) || 3306,
    dbUser: process.env.DB_USER || "root",
    dbPassword: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "pos_system",
    nodeEnv : process.env.NODE_ENV || "development",
    accessTokenSecret: process.env.JWT_SECRET,
    midtransClientKey: process.env.MIDTRANS_CLIENT_KEY,
    midtransServerKey: process.env.MIDTRANS_SERVER_KEY,
    midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === "true"
});

module.exports = config;
