import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { z } from "zod";
import { db } from "../db.js";
import { globalRateLimiter } from "./rate-limiter.js";
import { isFmpDisabled } from "./market-data.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const MAX_TRANSCRIPT_CHARS = 60000;

const MAX_RISK_FLAGS = 8;
const MAX_HIGHLIGHTS = 6;
const MAX_SUMMARY_CHARS = 800;

const AnalysisSchema = z.object({
  tone: z.enum(["bullish", "neutral", "bearish"]),
  toneScore: z.number().min(-1).max(1),
  guidanceDirection: z.enum(["raised", "maintained", "lowered", "none"]),
  riskFlags: z.array(z.string()),
  highlights: z.array(z.string()),
  summary: z.string(),
});

export type TranscriptAnalysis = z.infer<typeof AnalysisSchema>;

const SYSTEM_PROMPT = `You are an equity research analyst specializing in earnings call transcript analysis for breakout-trading signal scoring.

Given an earnings call transcript, extract a concise, structured assessment focused on what matters for a breakout/momentum thesis over the next 1-4 weeks.

Fields:
- tone: overall management tone — "bullish" / "neutral" / "bearish"
- toneScore: -1.0 (very bearish) to +1.0 (very bullish), reflects strength of the read
- guidanceDirection: did forward guidance get "raised", "maintained", "lowered", or was there "none" provided
- riskFlags: up to 8 short phrases for material risks management acknowledged (margin pressure, customer concentration, regulatory, supply chain, demand softness, etc). Empty array if none material.
- highlights: up to 6 short phrases for positive catalysts (new product traction, large deals, accelerating growth, margin expansion, capital return, etc)
- summary: 3-5 sentence narrative summary (≤800 characters) tying the above into a momentum view

Be decisive but evidence-based. If guidance was reaffirmed without raise, that is "maintained" not "raised". Bullish ≠ uncritical — flag risks even on strong quarters.`;

interface FmpTranscript {
  symbol: string;
  quarter: number;
  year: number;
  date: string;
  content: string;
}

// Latest transcript quarter/year via the v4 dates endpoint — a few hundred
// bytes vs. the multi-MB full-history payload the bare v3 endpoint returns.
// Lets the DB cache be checked BEFORE any transcript text is downloaded.
async function fetchLatestTranscriptMeta(
  symbol: string,
): Promise<{ quarter: number; year: number; date: string } | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || isFmpDisabled()) return null;

  try {
    const data = await globalRateLimiter.execute(async () => {
      const res = await axios.get(
        `https://financialmodelingprep.com/api/v4/earning_call_transcript?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        { timeout: 10000 },
      );
      return res.data;
    });
    // Rows are [quarter, year, date], newest first.
    if (!Array.isArray(data) || data.length === 0) return null;
    const [q, y, date] = Array.isArray(data[0]) ? data[0] : [];
    if (!Number(q) || !Number(y)) return null;
    return { quarter: Number(q), year: Number(y), date: String(date || "") };
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    console.warn(`[Transcript] FMP meta fetch failed for ${symbol}:`, error?.message);
    return null;
  }
}

// Download exactly one transcript (cache-miss path only).
async function fetchTranscript(
  symbol: string,
  quarter: number,
  year: number,
): Promise<FmpTranscript | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || isFmpDisabled()) return null;

  try {
    const data = await globalRateLimiter.execute(async () => {
      const res = await axios.get(
        `https://financialmodelingprep.com/api/v3/earning_call_transcript/${encodeURIComponent(symbol)}?quarter=${quarter}&year=${year}&apikey=${apiKey}`,
        { timeout: 10000 },
      );
      return res.data;
    });

    if (!Array.isArray(data) || data.length === 0) return null;
    const latest = data[0];
    if (!latest?.content || typeof latest.content !== "string") return null;

    return {
      symbol,
      quarter: Number(latest.quarter) || quarter,
      year: Number(latest.year) || year,
      date: latest.date || "",
      content: latest.content,
    };
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    console.warn(`[Transcript] FMP fetch failed for ${symbol}:`, error?.message);
    return null;
  }
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

async function analyzeWithClaude(
  symbol: string,
  transcript: string,
): Promise<{ analysis: TranscriptAnalysis; inputTokens: number; outputTokens: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[Transcript] ANTHROPIC_API_KEY not set — skipping analysis");
    return null;
  }

  const truncated =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[TRANSCRIPT TRUNCATED]"
      : transcript;

  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tone: { type: "string", enum: ["bullish", "neutral", "bearish"] },
            toneScore: { type: "number" },
            guidanceDirection: {
              type: "string",
              enum: ["raised", "maintained", "lowered", "none"],
            },
            riskFlags: { type: "array", items: { type: "string" } },
            highlights: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
          required: [
            "tone",
            "toneScore",
            "guidanceDirection",
            "riskFlags",
            "highlights",
            "summary",
          ],
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `Symbol: ${symbol}\n\nEarnings call transcript:\n\n${truncated}`,
      },
    ],
  } as any);

  const textBlock = response.content.find((b: any) => b.type === "text") as any;
  if (!textBlock) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    console.warn(`[Transcript] ${symbol}: model returned non-JSON output`);
    return null;
  }

  const validated = AnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    console.warn(`[Transcript] ${symbol}: schema validation failed`, validated.error.message);
    return null;
  }

  const analysis: TranscriptAnalysis = {
    ...validated.data,
    riskFlags: validated.data.riskFlags.slice(0, MAX_RISK_FLAGS),
    highlights: validated.data.highlights.slice(0, MAX_HIGHLIGHTS),
    summary: validated.data.summary.slice(0, MAX_SUMMARY_CHARS),
  };

  return {
    analysis,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export interface StoredTranscriptAnalysis extends TranscriptAnalysis {
  asset: string;
  quarter: number;
  year: number;
  modelUsed: string;
  createdAt: Date;
}

export async function getOrAnalyzeTranscript(
  symbol: string,
): Promise<StoredTranscriptAnalysis | null> {
  // Meta first (tiny payload), then cache check — the full transcript text is
  // only ever downloaded once per (symbol, quarter). If FMP is unreachable or
  // disabled, serve the newest stored analysis rather than nothing: a
  // quarter-old tone read still beats a null for confidence scoring.
  const meta = await fetchLatestTranscriptMeta(symbol);
  if (!meta) {
    const latest = await db.transcriptAnalysis.findFirst({
      where: { asset: symbol },
      orderBy: [{ year: "desc" }, { quarter: "desc" }],
    });
    if (!latest) return null;
    return {
      asset: latest.asset,
      quarter: latest.quarter,
      year: latest.year,
      tone: latest.tone as TranscriptAnalysis["tone"],
      toneScore: latest.toneScore,
      guidanceDirection:
        latest.guidanceDirection as TranscriptAnalysis["guidanceDirection"],
      riskFlags: (latest.riskFlags as string[]) || [],
      highlights: (latest.highlights as string[]) || [],
      summary: latest.summary,
      modelUsed: latest.modelUsed,
      createdAt: latest.createdAt,
    };
  }

  const cached = await db.transcriptAnalysis.findUnique({
    where: {
      asset_quarter_year: {
        asset: symbol,
        quarter: meta.quarter,
        year: meta.year,
      },
    },
  });

  if (cached) {
    return {
      asset: cached.asset,
      quarter: cached.quarter,
      year: cached.year,
      tone: cached.tone as TranscriptAnalysis["tone"],
      toneScore: cached.toneScore,
      guidanceDirection:
        cached.guidanceDirection as TranscriptAnalysis["guidanceDirection"],
      riskFlags: (cached.riskFlags as string[]) || [],
      highlights: (cached.highlights as string[]) || [],
      summary: cached.summary,
      modelUsed: cached.modelUsed,
      createdAt: cached.createdAt,
    };
  }

  const transcript = await fetchTranscript(symbol, meta.quarter, meta.year);
  if (!transcript) return null;

  const result = await analyzeWithClaude(symbol, transcript.content);
  if (!result) return null;

  const stored = await db.transcriptAnalysis.create({
    data: {
      asset: symbol,
      quarter: transcript.quarter,
      year: transcript.year,
      tone: result.analysis.tone,
      toneScore: result.analysis.toneScore,
      guidanceDirection: result.analysis.guidanceDirection,
      riskFlags: result.analysis.riskFlags,
      highlights: result.analysis.highlights,
      summary: result.analysis.summary,
      modelUsed: MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });

  console.log(
    `[Transcript] ${symbol} Q${transcript.quarter} ${transcript.year}: ${result.analysis.tone} (${result.analysis.toneScore.toFixed(2)}), guidance ${result.analysis.guidanceDirection}`,
  );

  return {
    asset: stored.asset,
    quarter: stored.quarter,
    year: stored.year,
    tone: result.analysis.tone,
    toneScore: result.analysis.toneScore,
    guidanceDirection: result.analysis.guidanceDirection,
    riskFlags: result.analysis.riskFlags,
    highlights: result.analysis.highlights,
    summary: result.analysis.summary,
    modelUsed: stored.modelUsed,
    createdAt: stored.createdAt,
  };
}
