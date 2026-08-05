import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MODEL = process.env.AI_REVIEW_MODEL || "claude-haiku-4-5";
const ENABLED = process.env.AI_ASSISTANCE === "true";

const ReviewSchema = z.object({
  rating: z.number().min(1).max(10),
  strength: z.string().max(200),
  watchFor: z.string().max(200),
});

export type SignalReview = z.infer<typeof ReviewSchema>;

export interface SignalReviewInput {
  asset: string;
  breakoutType: "Type1" | "Type3";
  currentPrice: number;
  resistance: number;
  support: number;
  confidence: number;
  volumeRatio: number;
  sector?: string | null;
  industry?: string | null;
  epsGrowthPct?: number | null;
  revenueGrowthPct?: number | null;
  priorBaseDays?: number | null;
  priorBaseRangePct?: number | null;
  priorBreakoutBarsAgo?: number | null;
}

const SYSTEM_PROMPT = `You are a swing-trading analyst reviewing a breakout signal that already passed a rule-based screen (MA stack ✓, volume ✓, structural gates ✓). Your job is a quick second opinion for the trader.

Return three fields:
- rating (1-10): overall setup quality. 10 = textbook Type 1 with strong context. 5 = passable. Below 5 = red flags outweigh the technical signal.
- strength (≤200 chars): the single strongest reason to take this trade — technical, fundamental, or context.
- watchFor (≤200 chars): the single biggest risk or thing to monitor — proximity to resistance, sector weakness, earnings gap, extension risk, etc.

Be direct and specific. Reference actual numbers from the signal. No hedging fluff. If the setup looks weak, say so plainly.`;

export async function reviewSignal(input: SignalReviewInput): Promise<SignalReview | null> {
  if (!ENABLED) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[AI Review] ANTHROPIC_API_KEY not set, skipping");
    return null;
  }

  const context = formatContext(input);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Review this signal and respond with JSON only (no markdown):\n${context}\n\nFormat: {"rating": N, "strength": "...", "watchFor": "..."}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return ReviewSchema.parse(JSON.parse(jsonMatch[0]));
  } catch (err: any) {
    console.warn(`[AI Review] ${input.asset} failed:`, err?.message);
    return null;
  }
}

function formatContext(s: SignalReviewInput): string {
  const lines = [
    `Asset: ${s.asset} (${s.sector || "?"} / ${s.industry || "?"})`,
    `Signal: ${s.breakoutType === "Type1" ? "Fresh breakout" : "Extension / continuation"} at ${(s.confidence * 100).toFixed(0)}% confidence`,
    `Price: $${s.currentPrice.toFixed(2)}`,
    `Resistance (breakout level): $${s.resistance.toFixed(2)} — currently ${(((s.currentPrice - s.resistance) / s.resistance) * 100).toFixed(1)}% ${s.currentPrice >= s.resistance ? "above" : "below"}`,
    `Support: $${s.support.toFixed(2)}`,
    `Volume: ${s.volumeRatio.toFixed(1)}x average`,
    s.epsGrowthPct != null ? `EPS growth: ${s.epsGrowthPct.toFixed(1)}%` : null,
    s.revenueGrowthPct != null ? `Revenue growth: ${s.revenueGrowthPct.toFixed(1)}%` : null,
    s.priorBaseDays != null
      ? `Prior base: ${s.priorBaseDays} days, ${s.priorBaseRangePct?.toFixed(1) ?? "?"}% range`
      : null,
    s.priorBreakoutBarsAgo != null && s.priorBreakoutBarsAgo > 0
      ? `Prior high-volume breakout: ${s.priorBreakoutBarsAgo} bars ago`
      : null,
  ].filter(Boolean);
  return lines.join("\n");
}
