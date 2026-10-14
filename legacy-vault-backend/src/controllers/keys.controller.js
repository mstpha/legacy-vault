const keysService = require("../services/keys.service");

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

// /api/keys/me
const getMine = wrap(async (req, res) => res.status(200).json(await keysService.getMyKey(req.user.sub)));

const registerMine = wrap(async (req, res) =>
  res.status(200).json(await keysService.registerPublicKey(req.user.sub, req.body?.publicKey))
);

const removeMine = wrap(async (req, res) => {
  await keysService.removePublicKey(req.user.sub);
  res.status(204).send();
});

// /api/capsules/:id/...
const listRecipients = wrap(async (req, res) =>
  res.status(200).json(await keysService.listKeyRecipients(req.params.id, req.user.sub))
);

const saveShares = wrap(async (req, res) =>
  res.status(200).json(await keysService.saveKeyShares(req.params.id, req.user.sub, req.body?.shares))
);

const getSharedKey = wrap(async (req, res) =>
  res.status(200).json(await keysService.getKeyShareForBeneficiary(req.params.id, req.user.sub))
);

module.exports = { getMine, registerMine, removeMine, listRecipients, saveShares, getSharedKey };
