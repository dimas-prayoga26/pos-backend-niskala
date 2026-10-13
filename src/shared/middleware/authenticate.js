const createHttpError = require("http-errors");
const userService = require("../../modules/users/user.service");

// Loads the user identified by the accessToken cookie into req.user.
const authenticate = async (req, res, next) => {
  try {
    const { accessToken } = req.cookies;

    if (!accessToken) {
      return next(createHttpError(401, "Please provide token!"));
    }

    const decodedToken = userService.verifyAccessToken(accessToken);
    const user = await userService.findById(decodedToken._id);

    if (!user) {
      return next(createHttpError(401, "User not exist!"));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(createHttpError(401, "Invalid Token!"));
  }
};

module.exports = authenticate;
