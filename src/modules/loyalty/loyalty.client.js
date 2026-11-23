// HTTP client for the loyalty app's /api/pos/* (system-loyalty-niskala).
// Server to server with a shared Bearer token; the browser never sees it.
const config = require("../../config/env");

// The loyalty app turned the request down by its rules (e.g. a reward not
// ready yet): its message is meant for the cashier.
class LoyaltyRefusedError extends Error {
  constructor(status, body) {
    super(body?.message || "Permintaan loyalty ditolak.");
    this.statusCode = status;
    this.reason = body?.reason || "";
    this.details = body?.errors;
  }
}

// Not configured, unreachable, too slow or broken: the POS carries on
// without loyalty.
class LoyaltyUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.statusCode = 503;
    this.cause = cause;
  }
}

// Where to call and with which key: Pengaturan → API once the app registers
// it (modules/integrations), else .env (unit tests, scripts).
let connectionResolver = async () => ({ apiUrl: config.loyalty.apiUrl, apiToken: config.loyalty.apiToken });

const setConnectionResolver = (resolver) => {
  connectionResolver = resolver;
};

const getConnection = async () => {
  try {
    return (await connectionResolver()) || {};
  } catch (error) {
    throw new LoyaltyUnavailableError("Pengaturan loyalty tidak terbaca.", error);
  }
};

const isConfigured = async () => {
  try {
    const { apiUrl, apiToken } = await getConnection();
    return Boolean(apiUrl && apiToken);
  } catch {
    return false;
  }
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

// { status, data } for 2xx; LoyaltyRefusedError for a rule refusal (4xx
// other than auth); LoyaltyUnavailableError for everything else.
// connection: { apiUrl, apiToken } to try instead of the saved one (Tes koneksi).
const request = async (method, path, body, { fetchImpl = globalThis.fetch, connection } = {}) => {
  const { apiUrl, apiToken } = connection || (await getConnection());
  if (!apiUrl || !apiToken) {
    throw new LoyaltyUnavailableError("Loyalty belum dikonfigurasi.");
  }

  let response;
  try {
    response = await fetchImpl(`${String(apiUrl).replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.loyalty.timeoutMs),
    });
  } catch (error) {
    throw new LoyaltyUnavailableError("Loyalty tidak dapat dihubungi.", error);
  }

  const data = await readJson(response);

  if (response.ok) {
    return { status: response.status, data };
  }

  // 401/403: wrong token, a setup problem rather than the cashier's.
  if (response.status >= 400 && response.status < 500 && ![401, 403, 429].includes(response.status)) {
    throw new LoyaltyRefusedError(response.status, data);
  }

  throw new LoyaltyUnavailableError(`Loyalty membalas ${response.status}.`);
};

module.exports = {
  LoyaltyRefusedError,
  LoyaltyUnavailableError,
  isConfigured,
  request,
  setConnectionResolver,
};
