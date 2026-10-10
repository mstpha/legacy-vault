const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// The full permissions matrix shown on the Roles & Permissions page. Edit this
// list to add new permissions as later sprints introduce new actions — re-running
// the seed is additive (upsert), it won't wipe toggles an admin already changed.
const PERMISSIONS = [
  // Testator
  { role: "TESTATOR", permission: "capsule.create", label: "Create a capsule" },
  { role: "TESTATOR", permission: "capsule.edit_draft", label: "Edit a draft capsule" },
  { role: "TESTATOR", permission: "capsule.delete_draft", label: "Delete a draft capsule" },
  { role: "TESTATOR", permission: "capsule.manage_members", label: "Assign guarantors / beneficiaries" },
  { role: "TESTATOR", permission: "capsule.manage_thresholds", label: "Set inactivity delay & validation threshold" },
  { role: "TESTATOR", permission: "capsule.activate", label: "Activate a capsule (Draft -> Active)" },
  { role: "TESTATOR", permission: "capsule.revoke", label: "Revoke a capsule" },
  { role: "TESTATOR", permission: "capsule.confirm_activity", label: "Confirm activity during a grace window" },
  { role: "TESTATOR", permission: "capsule.upload_file", label: "Attach an encrypted file to a capsule" },

  // Guarantor
  { role: "GUARANTOR", permission: "capsule.view_assigned", label: "View capsules they guarantee (status only)" },
  { role: "GUARANTOR", permission: "validation.submit", label: "Submit a validation vote" },

  // Beneficiary
  { role: "BENEFICIARY", permission: "capsule.view_unlocked", label: "View an unlocked capsule's content" },
];

async function main() {
  for (const p of PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where: { role_permission: { role: p.role, permission: p.permission } },
      update: { label: p.label },
      create: p,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} role/permission pairs.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
