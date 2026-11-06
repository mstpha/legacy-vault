const permissionsService = require("../services/permissions.service");
const { writeAuditLog } = require("../services/audit.service");

async function list(req, res, next) {
  try {
    const matrix = await permissionsService.listPermissions();
    res.status(200).json({ permissions: matrix });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { role, permission } = req.params;
    const { enabled } = req.body;
    const updated = await permissionsService.setPermission(role, permission, enabled);

    // Changing who is allowed to do what is a sensitive action: it goes in the audit chain.
    writeAuditLog({ userId: req.user.sub, action: "PERMISSION_CHANGED", metadata: { role, permission, enabled } });

    res.status(200).json({ permission: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, update };
