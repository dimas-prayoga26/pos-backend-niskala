// Encrypts secrets kept in the database (API keys of API Management) with
// AES-256-GCM. The key comes from JWT_SECRET: a stolen dump alone does not
// reveal them. Rotating JWT_SECRET makes stored secrets unreadable (open()
// returns null): they are then entered again.
const crypto = require("node:crypto");
const config = require("../../config/env");

const VERSION = "v1";

const keyOf = (secret) => crypto.createHash("sha256").update(`${secret || ""}:api-integrations`).digest();

const seal = (plain, secret = config.accessTokenSecret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
};

// The plain text, or null when it can't be read (another key, tampered).
const open = (sealed, secret = config.accessTokenSecret) => {
  const [version, iv, tag, data] = String(sealed || "").split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};

module.exports = { open, seal };
