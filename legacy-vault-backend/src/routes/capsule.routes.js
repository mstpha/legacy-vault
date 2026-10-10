const express = require("express");
const controller = require("../controllers/capsule.controller");
const { requireAuth } = require("../middleware/requireAuth");
const { validationLimiter, unlockLimiter } = require("../middleware/sensitiveLimiters");
const {
  createCapsuleSchema,
  updateCapsuleSchema,
  thresholdsSchema,
  addMemberSchema,
  uploadFileSchema,
  validate,
} = require("../utils/validators");

const router = express.Router();

router.use(requireAuth);

router.post("/", validate(createCapsuleSchema), controller.create);
router.get("/", controller.listMine);

// Guarantor / beneficiary side. The sensitive ones are rate limited per user:
//   - validation (casting the vote that can unlock a capsule)
//   - opening an unlocked capsule (content, file downloads, read confirmation)
router.get("/:id/shared", controller.getShared);
router.get("/:id/shared/content", unlockLimiter, controller.getSharedContent);
router.get("/:id/shared/files/:fileId", unlockLimiter, controller.getSharedFile);
router.post("/:id/shared/confirm-read", unlockLimiter, controller.confirmRead);
router.post("/:id/validate", validationLimiter, controller.validateAsGuarantor);

router.get("/:id", controller.getOne);
router.get("/:id/content", controller.getContent);
router.patch("/:id", validate(updateCapsuleSchema), controller.update);
router.delete("/:id", controller.remove);

router.post("/:id/guarantors", validate(addMemberSchema), controller.addGuarantor);
router.delete("/:id/guarantors/:userId", controller.removeGuarantor);

router.post("/:id/beneficiaries", validate(addMemberSchema), controller.addBeneficiary);
router.delete("/:id/beneficiaries/:userId", controller.removeBeneficiary);

router.put("/:id/thresholds", validate(thresholdsSchema), controller.setThresholds);
router.post("/:id/activate", controller.activate);
router.post("/:id/revoke", controller.revoke);

// Sprint 3: testator responding to an inactivity alert during the grace window.
router.post("/:id/confirm-activity", controller.confirmActivity);

router.post("/:id/files", validate(uploadFileSchema), controller.attachFile);

module.exports = router;
