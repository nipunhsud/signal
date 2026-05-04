export interface AgentTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface AgentResponse {
  thinking?: string;
  decision: string;
  signals?: Signal[];
  confidence?: number;
  reasoning?: string;
  raw?: string;
}

export interface Signal {
  asset: string;
  type: 'breakout' | 'reversal' | 'divergence' | 'other';
  confidence: number;
  timestamp: Date;
  details: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  maxTokens?: number;
}
