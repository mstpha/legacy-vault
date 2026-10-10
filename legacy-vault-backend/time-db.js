// Runs the inactivity sweep once, right now (no Redis / BullMQ needed).
// Usage, from the backend root folder:   node run-sweep.js
require("dotenv").config();

const { runInactivitySweep } = require("./src/services/monitoring.service");
const { flushPendingEmails } = require("./src/services/notification.service");

// Emails are sent in the background, so we must wait for them before exiting.
// The timeout is a safety net so the script can never hang forever.
const waitForEmails = () =>
  Promise.race([flushPendingEmails(), new Promise((resolve) => setTimeout(resolve, 20000))]);

runInactivitySweep()
  .then(async (result) => {
    console.log("Sweep result:", result);
    console.log("Waiting for emails to finish sending...");
    await waitForEmails();
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sweep failed:", err);
    process.exit(1);
  });