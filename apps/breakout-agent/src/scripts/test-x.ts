import "dotenv/config";
import { postXThread } from "../x-post.js";
import { BreakoutAgent } from "../agent.js";

// Manual X test harness. Fire a post on demand instead of waiting for a cron.
//   node dist/scripts/test-x.js ping      → post a 2-tweet connectivity thread
//   node dist/scripts/test-x.js teaser    → run the real signal-teaser job
//   node dist/scripts/test-x.js earnings  → run the real earnings-thread job
//   node dist/scripts/test-x.js audit     → run the real performance-audit job
//
// Needs X_POST_ENABLED=true + the four X_* tokens. teaser/earnings/audit also
// need DB access (and audit needs to reach the dashboard) — easiest inside the
// container: docker compose exec agent-tier-1 node dist/scripts/test-x.js ping
async function main() {
  const mode = process.argv[2] || "ping";

  if (process.env.X_POST_ENABLED !== "true") {
    console.log("[test-x] X_POST_ENABLED is not 'true' — postToX is a no-op. Set it + the X_* tokens and retry.");
    process.exit(1);
  }

  if (mode === "ping") {
    const ok = await postXThread([
      "DataQuant X connectivity test ✅ (ignore)",
      "Reply test — confirms OAuth 1.0a write access + threading.",
    ]);
    console.log(ok ? "[test-x] posted ✓ — check the account timeline" : "[test-x] FAILED — check tokens + app is Read/Write");
    process.exit(ok ? 0 : 1);
  }

  const agent = new BreakoutAgent();
  const jobs: Record<string, () => Promise<void>> = {
    teaser: () => agent.postXSignalTeasers(),
    earnings: () => agent.postXEarningsThreads(),
    audit: () => agent.postXPerformanceAudit(),
  };
  const job = jobs[mode];
  if (!job) {
    console.log(`[test-x] unknown mode '${mode}'. Use: ping | teaser | earnings | audit`);
    process.exit(1);
  }
  console.log(`[test-x] running '${mode}'…`);
  await job();
  process.exit(0);
}

main().catch((e) => {
  console.error("[test-x] error:", e);
  process.exit(1);
});
