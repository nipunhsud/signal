-- CreateTable
CREATE TABLE "User" (
    "id"                    TEXT NOT NULL,
    "clerkUserId"           TEXT NOT NULL,
    "email"                 TEXT,
    "stripeCustomerId"      TEXT,
    "stripeSubscriptionId"  TEXT,
    "subscriptionStatus"    TEXT,
    "trialEndsAt"           TIMESTAMP(3),
    "currentPeriodEndsAt"   TIMESTAMP(3),
    "cancelAtPeriodEnd"     BOOLEAN NOT NULL DEFAULT false,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "User_subscriptionStatus_idx" ON "User"("subscriptionStatus");
