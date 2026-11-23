// api_integrations: the outside services the POS calls, set in Pengaturan →
// API (modules/integrations). One row per service (code), its base URL and
// its API key (sealed by shared/utils/secretBox, never sent to a browser).
// For now: loyalty (system-loyalty-niskala, Stamp Card). The first time, a
// loyalty set in .env (LOYALTY_API_URL / LOYALTY_API_TOKEN) is moved in;
// from then on the row decides.
const config = require("../../../config/env");
const { seal } = require("../../../shared/utils/secretBox");

const ensureApiIntegrationsSchema = async (db) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_integrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      base_url VARCHAR(255) NOT NULL DEFAULT '',
      api_key_sealed TEXT NULL,
      api_key_hint VARCHAR(8) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const { apiUrl, apiToken } = config.loyalty;
  if (apiUrl && apiToken) {
    await db.query(
      `INSERT IGNORE INTO api_integrations (code, base_url, api_key_sealed, api_key_hint, is_active)
       VALUES ('loyalty', ?, ?, ?, TRUE)`,
      [apiUrl, seal(apiToken), apiToken.slice(-4)]
    );
  }
};

module.exports = { ensureApiIntegrationsSchema };
