// Single source of truth for what every notification says. Used by BOTH the emails
// and the in-app Notifications screen, so the two can never drift apart.
//
// tone   -> colour/icon family: info | warning | action | success | danger
// target -> which screen a tap should open: "owner" (testator view) or "shared"
//           (guarantor / beneficiary view)

const SUBJECTS = {
  GUARANTOR_ASSIGNED: "You've been named a guarantor",
  BENEFICIARY_ASSIGNED: "You've been named a beneficiary",
  INACTIVITY_ALERT: "Action needed: confirm you're still active",
  VALIDATION_REQUEST: "Action needed: a capsule is waiting for your validation",
  VALIDATION_RECEIVED: "A guarantor validated your capsule",
  CAPSULE_UNLOCKED: "A capsule has been unlocked",
  CAPSULE_ACCESS_ATTEMPT: "Someone tried to open your capsule early",
  CAPSULE_REVOKED: "A capsule was revoked",
};

const OWNER_TYPES = new Set(["INACTIVITY_ALERT", "VALIDATION_RECEIVED", "CAPSULE_ACCESS_ATTEMPT"]);

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

function describeNotification(type, payload = {}, ctx = {}) {
  const capsule = ctx.capsuleTitle ? `"${ctx.capsuleTitle}"` : "a capsule";
  const owner = ctx.testatorName || "The capsule owner";
  const deadline = formatDate(payload.graceWindowExpiresAt);

  const details = [];
  if (ctx.capsuleTitle) details.push({ label: "Capsule", value: ctx.capsuleTitle });
  const addOwner = () => ctx.testatorName && details.push({ label: "Owner", value: ctx.testatorName });

  const target =
    OWNER_TYPES.has(type) || (type === "CAPSULE_UNLOCKED" && payload.audience === "TESTATOR") ? "owner" : "shared";

  let title;
  let message;
  let tone = "info";

  switch (type) {
    case "GUARANTOR_ASSIGNED":
      title = "You're now a guarantor";
      message = `${owner} named you a guarantor on ${capsule}. If they stop being active, you'll be asked to confirm the situation. Nothing is needed from you right now.`;
      addOwner();
      break;

    case "BENEFICIARY_ASSIGNED":
      title = "You're now a beneficiary";
      message = `${owner} named you a beneficiary on ${capsule}. You'll only get access if the capsule is unlocked after validation. The content is encrypted, so ask ${owner} to share the passphrase with you in person or through a trusted channel.`;
      addOwner();
      break;

    case "INACTIVITY_ALERT":
      title = "Are you still there?";
      message = `You've been inactive for longer than your threshold on ${capsule}. Open the app ${deadline ? ` before ${deadline}` : ""}. Otherwise your guarantors will be asked to validate.`;
      tone = "warning";
      if (deadline) details.push({ label: "Respond before", value: deadline });
      break;

    case "VALIDATION_REQUEST":
      title = "Your validation is needed";
      message = `${owner} didn't respond to the inactivity alert on ${capsule}. If you can confirm they're unable to manage it, open the capsule and validate. If this is a false alarm, don't validate - the capsule stays locked until enough guarantors do.`;
      tone = "action";
      addOwner();
      break;

    case "VALIDATION_RECEIVED":
      title = "A guarantor validated";
      message = payload.received
        ? `${payload.received} of ${payload.required} guarantors have validated ${capsule}. It unlocks when the threshold is reached. If this is a mistake, you can still revoke the capsule.`
        : `A guarantor validated ${capsule}.`;
      tone = "warning";
      if (payload.received) details.push({ label: "Validations", value: `${payload.received} of ${payload.required}` });
      break;

    case "CAPSULE_UNLOCKED":
      tone = "success";
      if (payload.audience === "TESTATOR") {
        title = "Your capsule was unlocked";
        message = `Enough guarantors validated ${capsule}, so it has been unlocked for your beneficiaries.`;
      } else {
        title = "A capsule was unlocked for you";
        message = `${capsule} has been unlocked. Open it in the app and enter the passphrase to read it.`;
        addOwner();
      }
      break;

    case "CAPSULE_ACCESS_ATTEMPT":
      title = "Early access attempt";
      message = `Someone tried to open ${capsule} while it was still locked. They were blocked and nothing was revealed.`;
      tone = "danger";
      break;

    case "CAPSULE_REVOKED":
      title = "Capsule revoked";
      message = `${owner} revoked ${capsule}. Its content has been erased and nothing more is needed from you.`;
      addOwner();
      break;

    default:
      title = "New notification";
      message = "You have a new notification. Open the app to see the details.";
  }

  return {
    subject: `Legacy Vault: ${SUBJECTS[type] || title}`,
    title,
    message,
    tone,
    target,
    details,
  };
}

module.exports = { describeNotification };