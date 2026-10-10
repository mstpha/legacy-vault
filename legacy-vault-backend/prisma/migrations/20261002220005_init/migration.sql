-- AlterEnum
ALTER TYPE "CapsuleType" ADD VALUE 'IMAGE';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'TESTATOR';
