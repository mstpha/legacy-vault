const express = require("express");
const controller = require("../controllers/permissions.controller");
const permissionsService = require("../services/permissions.service");
const { requireAuth } = require("../middleware/requireAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { setPermissionSchema, validate } = require("../utils/validators");
const { ApiError } = require("../middleware/errorHandler");

const router = express.Router();

const VALID_ROLES = ["TESTATOR", "GUARANTOR", "BENEFICIARY"];
function validateRoleParam(req, res, next) {
  if (!VALID_ROLES.includes(req.params.role)) {
    return next(new ApiError(400, `Unknown role "${req.params.role}".`));
  }
  next();
}

// Pre-flight check for ANY signed-in user (not admin-only): the app calls this before
// doing slow work (like encrypting) so it can warn immediately if an action is disabled.
//   GET /api/permissions/check?role=TESTATOR&keys=capsule.create,capsule.upload_file
//   -> { blocked: [{ permission, message }] }   (empty array = everything allowed)
router.get("/check", requireAuth, async (req, res, next) => {
  try {
    const { role, keys } = req.query;
    if (!VALID_ROLES.includes(role)) throw new ApiError(400, `Unknown role "${role}".`);

    const list = String(keys || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 20);

    const blocked = await permissionsService.checkPermissions(role, list);
    res.status(200).json({ blocked });
  } catch (err) {
    next(err);
  }
});

router.get("/", requireAuth, requireAdmin, controller.list);
router.patch(
  "/:role/:permission",
  requireAuth,
  requireAdmin,
  validateRoleParam,
  validate(setPermissionSchema),
  controller.update
);

module.exports = router;