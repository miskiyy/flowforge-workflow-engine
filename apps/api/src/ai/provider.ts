/**
 * The provider boundary: dumb, text-in-text-out. It does not parse, validate,
 * or retry — that's ai/propose.ts's job. Swapping providers touches one file
 * (this interface's implementation), never the orchestrator.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface DagProposer {
  complete(messages: ChatMessage[]): Promise<{ text: string; usage: Usage }>;
}

/** A small, always-schema-valid linear DAG — deliberately simple so the mock provider never needs the repair loop. */
const DEFAULT_MOCK_DRAFT = JSON.stringify({
  steps: [
    { key: 'step1', type: 'delay', dependsOn: [], durationMs: 1000 },
    { key: 'step2', type: 'delay', dependsOn: ['step1'], durationMs: 1000 },
  ],
});

export interface MockProposerOptions {
  /**
   * Canned responses returned in order, one per `complete()` call — lets
   * tests script exact sequences (garbage then a fix, always-invalid, a
   * cycle, etc.). Holds on the last entry once the queue is exhausted, so a
   * single-entry queue behaves like a fixed response. Defaults to a
   * deterministic valid draft, which is what `AI_PROVIDER=mock` runtime use
   * needs — a labeled, honest offline demo (see ai-subsystem-design.md §11).
   */
  responses?: string[];
}

export class MockProposer implements DagProposer {
  private readonly responses: string[];
  private callCount = 0;

  constructor(options: MockProposerOptions = {}) {
    this.responses = options.responses ?? [DEFAULT_MOCK_DRAFT];
  }

  // Ignores `messages` entirely — a MockProposer doesn't need to inspect the
  // prompt it was given, and TS allows implementing an interface method with
  // fewer parameters than its declared signature.
  async complete(): Promise<{ text: string; usage: Usage }> {
    const index = Math.min(this.callCount, this.responses.length - 1);
    const text = this.responses[index] ?? DEFAULT_MOCK_DRAFT;
    this.callCount += 1;
    return { text, usage: { promptTokens: 0, completionTokens: 0 } };
  }
}
