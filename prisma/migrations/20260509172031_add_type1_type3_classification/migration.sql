-- AlterTable
ALTER TABLE "BreakoutSignal" ADD COLUMN     "breakoutType" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "liquidityOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priorBaseDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priorBaseRangePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "priorBreakoutBarsAgo" INTEGER NOT NULL DEFAULT 0;
