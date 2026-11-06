const authService = require("../services/auth.service");

function meta(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

const register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};



async function login(req, res, next) {
  try {
    const result = await authService.login(req.body, meta(req));
    if (result.mfaRequired) {
      return res.status(200).json({ mfaRequired: true });
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function beginMfaEnrollment(req, res, next) {
  try {
    const result = await authService.beginMfaEnrollment(req.user.sub);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function confirmMfaEnrollment(req, res, next) {
  try {
    const result = await authService.confirmMfaEnrollment(req.user.sub, req.body.token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function disableMfa(req, res, next) {
  try {
    const result = await authService.disableMfaEnrollment(req.user.sub, req.body.token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}



const verifyEmail = async (req, res, next) => {
  try {
    const result = await authService.verifyEmail(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};


async function refresh(req, res, next) {
  try {
    const result = await authService.refresh(req.body.refreshToken, meta(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.body.refreshToken, req.user?.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    // Always re-read from the DB — the JWT's mfaEnabled claim is only as fresh as
    // whenever the access token was issued (see auth.service.getProfile).
    const user = await authService.getProfile(req.user.sub);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, beginMfaEnrollment, confirmMfaEnrollment,verifyEmail, disableMfa, refresh, logout, me };