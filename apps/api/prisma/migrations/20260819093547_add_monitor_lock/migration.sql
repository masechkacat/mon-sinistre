-- CreateTable
CREATE TABLE "MonitorLock" (
    "name" TEXT NOT NULL,
    "owner" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MonitorLock_pkey" PRIMARY KEY ("name")
);
