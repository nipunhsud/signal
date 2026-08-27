-- Admin-togglable runtime flags (no redeploy needed). First use: fmp_disabled —
-- scanners switch to Yahoo-only data on their next cycle when it's "true".
CREATE TABLE "RuntimeFlag" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeFlag_pkey" PRIMARY KEY ("key")
);
