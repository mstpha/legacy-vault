const express = require("express");
const controller = require("../controllers/notification.controller");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.use(requireAuth);

router.get("/", controller.list);
router.get("/unread-count", controller.unreadCount);
router.post("/read-all", controller.markAllRead);
router.post("/:id/read", controller.markRead);

module.exports = router;