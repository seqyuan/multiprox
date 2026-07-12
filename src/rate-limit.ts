export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  isBlocked(key: string): boolean {
    this.cleanup(key);
    const bucket = this.buckets.get(key);
    return bucket !== undefined && bucket.count >= this.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private cleanup(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket && Date.now() >= bucket.resetAt) {
      this.buckets.delete(key);
    }
  }
}
