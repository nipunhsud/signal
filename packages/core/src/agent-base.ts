import { GoogleGenerativeAI } from '@google/generative-ai';
import { AgentConfig, AgentResponse, AgentTool } from './types.js';
import { parseAgentResponse } from './parser.js';

export class TradeAgent {
  private client: GoogleGenerativeAI;
  private model: string;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = config.model || 'gemini-2.5-flash';
    this.config = config;
  }

  async run(
    prompt: string,
    _tools?: AgentTool[],
    useWebSearch = false,
  ): Promise<AgentResponse> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools: any = useWebSearch ? [{ googleSearch: {} }] : undefined;

      const response = await this.client
        .getGenerativeModel({ model: this.model })
        .generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          // @ts-ignore — googleSearchRetrieval is valid at runtime but sdk types lag
          tools,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 1,
          },
        });

      const text =
        response.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return parseAgentResponse(text);
    } catch (error) {
      console.error(`Agent ${this.config.name} error:`, error);
      return {
        decision: 'error',
        reasoning: `Agent failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  getName(): string {
    return this.config.name;
  }
}
