/**
 * In-process, per-key token bucket. Matches Task.md's locked "no message
 * broker" decision — single-instance, in-memory, resets on restart; a
 * production multi-instance deploy would move this state to Redis. Clock is
 * injectable so tests never depend on real timers.
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns true and consumes a token if the key has one available, false if it's exhausted. */
  consume(key: string): boolean {
    const nowMs = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: nowMs };

    const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
    const refilled = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, lastRefillMs: nowMs });
      return false;
    }

    this.buckets.set(key, { tokens: refilled - 1, lastRefillMs: nowMs });
    return true;
  }
}
