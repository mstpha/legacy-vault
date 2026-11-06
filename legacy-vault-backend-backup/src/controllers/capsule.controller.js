const capsuleService = require("../services/capsule.service");

async function create(req, res, next) {
  try {
    const capsule = await capsuleService.createCapsule(req.user.sub, req.body);
    res.status(201).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const capsules = await capsuleService.listMyCapsules(req.user.sub);
    res.status(200).json({ capsules });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const capsule = await capsuleService.getCapsuleForTestator(req.params.id, req.user.sub);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function getContent(req, res, next) {
  try {
    const encryptedContentBase64 = await capsuleService.getEncryptedContent(req.params.id, req.user.sub);
    res.status(200).json({ encryptedContentBase64 });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const capsule = await capsuleService.updateDraftCapsule(req.params.id, req.user.sub, req.body);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await capsuleService.deleteDraftCapsule(req.params.id, req.user.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function addGuarantor(req, res, next) {
  try {
    const guarantor = await capsuleService.addGuarantor(req.params.id, req.user.sub, req.body.email);
    res.status(201).json({ guarantor });
  } catch (err) {
    next(err);
  }
}

async function removeGuarantor(req, res, next) {
  try {
    await capsuleService.removeGuarantor(req.params.id, req.user.sub, req.params.userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function addBeneficiary(req, res, next) {
  try {
    const beneficiary = await capsuleService.addBeneficiary(req.params.id, req.user.sub, req.body.email);
    res.status(201).json({ beneficiary });
  } catch (err) {
    next(err);
  }
}

async function removeBeneficiary(req, res, next) {
  try {
    await capsuleService.removeBeneficiary(req.params.id, req.user.sub, req.params.userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function setThresholds(req, res, next) {
  try {
    const capsule = await capsuleService.setThresholds(req.params.id, req.user.sub, req.body);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const capsule = await capsuleService.activateCapsule(req.params.id, req.user.sub);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function revoke(req, res, next) {
  try {
    const capsule = await capsuleService.revokeCapsule(req.params.id, req.user.sub);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function confirmActivity(req, res, next) {
  try {
    const capsule = await capsuleService.confirmActivity(req.params.id, req.user.sub);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function attachFile(req, res, next) {
  try {
    const file = await capsuleService.attachFile(req.params.id, req.user.sub, req.body);
    res.status(201).json({ file });
  } catch (err) {
    next(err);
  }
}

// --- Guarantor / beneficiary side ---

async function getShared(req, res, next) {
  try {
    const capsule = await capsuleService.getSharedCapsule(req.params.id, req.user.sub);
    res.status(200).json({ capsule });
  } catch (err) {
    next(err);
  }
}

async function getSharedContent(req, res, next) {
  try {
    const encryptedContentBase64 = await capsuleService.getSharedContent(req.params.id, req.user.sub);
    res.status(200).json({ encryptedContentBase64 });
  } catch (err) {
    next(err);
  }
}

async function confirmRead(req, res, next) {
  try {
    const result = await capsuleService.confirmFirstRead(req.params.id, req.user.sub);
    res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
}

async function getSharedFile(req, res, next) {
  try {
    const file = await capsuleService.getSharedFileUrl(req.params.id, req.params.fileId, req.user.sub);
    res.status(200).json({ file });
  } catch (err) {
    next(err);
  }
}

async function validateAsGuarantor(req, res, next) {
  try {
    const result = await capsuleService.validateCapsule(req.params.id, req.user.sub);
    res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  listMine,
  getOne,
  getContent,
  update,
  remove,
  addGuarantor,
  removeGuarantor,
  addBeneficiary,
  removeBeneficiary,
  setThresholds,
  activate,
  revoke,
  confirmActivity,
  attachFile,
  getShared,
  getSharedContent,
  confirmRead,
  getSharedFile,
  validateAsGuarantor,
};
