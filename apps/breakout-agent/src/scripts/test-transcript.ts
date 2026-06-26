import "dotenv/config";
import { getOrAnalyzeTranscript } from "../tools/transcript-analysis.js";
import { db } from "../db.js";

const symbol = process.argv[2] || "INTC";

async function main() {
  console.log(`[test] running transcript analysis for ${symbol}`);
  try {
    const result = await getOrAnalyzeTranscript(symbol);
    if (!result) {
      console.log(`[test] returned null (no transcript / no key / parse fail)`);
    } else {
      console.log(`[test] success:`, JSON.stringify(result, null, 2));
    }
  } catch (err: any) {
    console.error(`[test] threw:`, err?.message);
    if (err?.status) console.error(`  status:`, err.status);
    if (err?.error) console.error(`  error body:`, JSON.stringify(err.error, null, 2));
    console.error(err?.stack);
  } finally {
    await db.$disconnect();
  }
}

main();
