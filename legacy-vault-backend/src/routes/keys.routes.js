const express = require("express");
const controller = require("../controllers/keys.controller");
const { requireAuth } = require("../middleware/requireAuth");
const { keyChangeLimiter } = require("../middleware/sensitiveLimiters");

const router = express.Router();

router.use(requireAuth);

// The signed-in user's own device (public) key. The private key never reaches the server.
router.get("/me", controller.getMine);
router.put("/me", keyChangeLimiter, controller.registerMine);
router.delete("/me", keyChangeLimiter, controller.removeMine);

module.exports = router;
