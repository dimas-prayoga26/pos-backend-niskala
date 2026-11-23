const asyncHandler = require("../../shared/http/asyncHandler");
const integrationService = require("./integration.service");

const respond = (res, data, status = 200) => {
  res.set("Cache-Control", "no-store");
  res.status(status).json({ success: true, data });
};

// Every signed-in user: which integrations are usable, for the screens to
// show or hide what depends on them ({ loyalty: true/false }).
const getStatus = asyncHandler(async (req, res) => {
  respond(res, { loyalty: await integrationService.isLoyaltyEnabled() });
});

const listIntegrations = asyncHandler(async (req, res) => {
  respond(res, await integrationService.list());
});

// { baseUrl, apiKey?, isActive }: apiKey left out (or empty) keeps the saved
// key, null removes it.
const updateIntegration = asyncHandler(async (req, res) => {
  const { baseUrl, apiKey, isActive } = req.body || {};
  respond(res, await integrationService.update(req.params.code, { baseUrl, apiKey, isActive }, req.user?._id));
});

const testIntegration = asyncHandler(async (req, res) => {
  const { baseUrl, apiKey } = req.body || {};
  respond(res, await integrationService.test(req.params.code, { baseUrl, apiKey }));
});

module.exports = { getStatus, listIntegrations, testIntegration, updateIntegration };
