-- AlterEnum
ALTER TYPE "MonitorAlertKind" ADD VALUE 'NOTIFICATION_STUCK';

-- AlterTable
ALTER TABLE "VeilleNotification" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
