-- Per-user named shortlists: introduce ShortlistList and point Shortlist rows at it.

-- CreateTable
CREATE TABLE "ShortlistList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShortlistList_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShortlistList_userId_name_key" ON "ShortlistList"("userId", "name");
CREATE INDEX "ShortlistList_userId_idx" ON "ShortlistList"("userId");
ALTER TABLE "ShortlistList" ADD CONSTRAINT "ShortlistList_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add listId nullable so we can backfill before enforcing NOT NULL.
ALTER TABLE "Shortlist" ADD COLUMN "listId" TEXT;

-- Backfill: park existing (previously global) rows in a 'US' list owned by the
-- account owner. Skipped cleanly if that user or any rows are absent.
DO $$
DECLARE owner_id TEXT; new_list_id TEXT;
BEGIN
  SELECT id INTO owner_id FROM "User" WHERE email = 'nipunhsud@gmail.com' LIMIT 1;
  IF owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM "Shortlist") THEN
    new_list_id := gen_random_uuid()::text;
    INSERT INTO "ShortlistList" (id, "userId", name, "order") VALUES (new_list_id, owner_id, 'US', 0);
    UPDATE "Shortlist" SET "listId" = new_list_id WHERE "listId" IS NULL;
  END IF;
END $$;

-- Anything still unowned can't satisfy NOT NULL; drop it.
DELETE FROM "Shortlist" WHERE "listId" IS NULL;

-- Swap the old global-unique asset for a per-list unique.
DROP INDEX IF EXISTS "Shortlist_asset_key";
DROP INDEX IF EXISTS "Shortlist_asset_idx";
ALTER TABLE "Shortlist" ALTER COLUMN "listId" SET NOT NULL;
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "ShortlistList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Shortlist_listId_asset_key" ON "Shortlist"("listId", "asset");
CREATE INDEX "Shortlist_listId_idx" ON "Shortlist"("listId");
