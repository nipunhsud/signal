// One-shot diagnostic: run the classifier on a specific ticker and print why
// it came back Type1 / Type3 / unknown. Usage inside container:
//   node dist/scripts/diagnose-classification.js DELL AMG
import { fetchMarketData } from "../tools/market-data.js";
import { analyzeBreakout } from "../tools/breakout-logic.js";

async function diagnose(asset: string) {
  console.log(`\n=== ${asset} ===`);
  const data = await fetchMarketData(asset);
  const b = analyzeBreakout(data);

  console.log(`close=$${data.close.toFixed(2)}  ma20=$${data.ma20.toFixed(2)}  ma50=$${data.ma50.toFixed(2)}  ma200=$${data.ma200.toFixed(2)}`);
  console.log(`52w high=$${(data.high52w ?? 0).toFixed(2)}  dist=${data.high52w ? (((data.high52w - data.close) / data.high52w) * 100).toFixed(1) : "?"}%`);
  console.log(`volume=${data.volume}  avgVolume=${data.avgVolume.toFixed(0)}  ratio=${(data.volume / data.avgVolume).toFixed(2)}x`);
  console.log(`---- classification ----`);
  console.log(`breakoutType=${b.breakoutType}  confidence=${(b.confidence * 100).toFixed(0)}%  pineScriptGreen=${b.pineScriptGreen}`);
  console.log(`breakoutSignal=${b.breakoutSignal}  maStack=${b.maStack}  volumeOk=${b.volumeOk}  liquidityOk=${b.liquidityOk}`);
  console.log(`---- inputs the classifier used ----`);
  console.log(`priorBaseDays=${data.priorBaseDays}  priorBaseRangePct=${data.priorBaseRangePercent?.toFixed(1) ?? "?"}%`);
  console.log(`priorBreakoutBarsAgo=${data.priorBreakoutBarsAgo}`);
  console.log(`extensionPriorBreakoutBarsAgo=${data.extensionPriorBreakoutBarsAgo}`);
  console.log(`barsInRange=${data.barsInRange}  consolRange=${data.consolidationRangePercent?.toFixed(1) ?? "?"}%  consolVol=${data.consolidationVolumePercent?.toFixed(0) ?? "?"}%`);
  console.log(`resistance=$${b.resistance.toFixed(2)}  support=$${b.support.toFixed(2)}`);
}

async function main() {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: diagnose-classification.js TICKER [TICKER ...]");
    process.exit(1);
  }
  for (const t of tickers) {
    try {
      await diagnose(t.toUpperCase());
    } catch (err: any) {
      console.error(`${t}: ${err?.message || err}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
