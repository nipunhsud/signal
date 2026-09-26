-- BreakoutSignal is append-only by createdAt, and autovacuum re-analyzes it
-- only after 10% of rows change (~29k). Between runs the planner believes no
-- row is newer than the last analyze: on 26 Sep 2026 it estimated 16 rows for
-- the dashboard's 3-day window against 4,976, and chose nested loops that
-- made /api/signals take 5.5s. 1% keeps the newest days inside the stats.
ALTER TABLE "BreakoutSignal" SET (autovacuum_analyze_scale_factor = 0.01);
ANALYZE "BreakoutSignal";
