const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { verifyAuditChain } = require("../services/audit.service");

const router = express.Router();

// Admin-only integrity check of the whole audit chain.
//   -> { valid, checked, legacyUnchained, brokenAt: null | { seq, id, reason } }
router.get("/verify", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.status(200).json(await verifyAuditChain());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
