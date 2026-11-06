const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { verifyAuditChain, listAuditEntries } = require("../services/audit.service");

const router = express.Router();

// Admin-only: the log itself, newest first.
//   GET /api/audit?group=access&capsuleId=...&before=<seq>&limit=30
//   -> { entries: [...], nextCursor: number | null }
router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { before, limit, group, capsuleId } = req.query;
    res.status(200).json(await listAuditEntries({ before, limit, group, capsuleId }));
  } catch (err) {
    next(err);
  }
});




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
