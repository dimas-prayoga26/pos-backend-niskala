// api_integrations (bootstrap/apiIntegrationsSchema.js).
const { pool } = require("../../infrastructure/database/pool");

const findByCode = async (code, db = pool) => {
  const [rows] = await db.query("SELECT * FROM api_integrations WHERE code = ? LIMIT 1", [code]);
  return rows[0] || null;
};

// fields: { baseUrl, apiKeySealed, apiKeyHint, isActive, updatedBy };
// apiKeySealed undefined keeps the key, null removes it.
const upsert = async (code, { baseUrl, apiKeySealed, apiKeyHint, isActive, updatedBy }, db = pool) => {
  const keepKey = apiKeySealed === undefined;
  await db.query(
    `INSERT INTO api_integrations (code, base_url, api_key_sealed, api_key_hint, is_active, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       base_url = VALUES(base_url),
       api_key_sealed = ${keepKey ? "api_key_sealed" : "VALUES(api_key_sealed)"},
       api_key_hint = ${keepKey ? "api_key_hint" : "VALUES(api_key_hint)"},
       is_active = VALUES(is_active),
       updated_by = VALUES(updated_by)`,
    [code, baseUrl, keepKey ? null : apiKeySealed, keepKey ? null : apiKeyHint, isActive ? 1 : 0, updatedBy ?? null]
  );
};

module.exports = { findByCode, upsert };
