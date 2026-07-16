import OpenAI from 'openai';
import { AiUnavailableError } from './errors.js';
import type { ChatMessage, DagProposer, Usage } from './provider.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOKENS = 1500;
/** SDK-internal transport retry (timeout/5xx/429), honoring `Retry-After` — distinct from the repair loop's retries (see ai/propose.ts). */
const TRANSPORT_MAX_RETRIES = 2;

export interface OpenRouterProposerOptions {
  apiKey: string;
  model: string;
}

/**
 * `DagProposer` over OpenRouter (OpenAI-compatible) via the official `openai`
 * SDK — the OpenRouter-recommended client, with typed request/response
 * shapes and correct `Retry-After` handling on 429 that free-tier traffic
 * will hit. JSON mode, not strict `json_schema`: see ai-subsystem-design.md
 * §7 for why the canonical schema can't be handed to strict mode verbatim.
 */
export class OpenRouterProposer implements DagProposer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenRouterProposerOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: TRANSPORT_MAX_RETRIES,
    });
    this.model = options.model;
  }

  async complete(messages: ChatMessage[]): Promise<{ text: string; usage: Usage }> {
    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
      });
    } catch {
      // Timeout, 5xx after transport retries, or 429 past the free-tier cap —
      // all expected, typed states (ai-subsystem-design.md §15), never a 500.
      throw new AiUnavailableError();
    }

    const text = completion.choices[0]?.message.content;
    if (!text) throw new AiUnavailableError('AI provider returned an empty response');

    return {
      text,
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }
}
