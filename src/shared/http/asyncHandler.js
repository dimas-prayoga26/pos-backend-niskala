// Forwards rejected promises (and sync throws) from a handler to next().
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);

module.exports = asyncHandler;
