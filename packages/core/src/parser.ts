import { AgentResponse } from "./types";

/**
 * Parse agent response, extracting JSON and text reasoning
 */
export function parseAgentResponse(text: string): AgentResponse {
  const trimmed = text.trim();

  // Try to extract JSON block
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  let parsed: Partial<AgentResponse> = {};

  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error("Failed to parse JSON from agent response:", e);
    }
  }

  // Fallback: try to parse entire response as JSON
  if (!parsed.decision) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      // Not JSON
    }
  }

  // Ensure response has required fields
  return {
    raw: trimmed,
    ...parsed,
    decision: parsed.decision || "unable_to_decide",
  } as AgentResponse;
}

/**
 * Clean display text (strip JSON, truncate at first brace)
 */
export function cleanDisplay(text: string): string {
  return text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .split("{")[0]
    .trim();
}
