/**
 * GroqScheduler — enforces GLOBAL_CONCURRENCY=1 for all Groq HTTP requests.
 *
 * Invariant: AT MOST 1 active Groq HTTP request at any time, process-wide.
 *
 * Double-release protection: every acquire() returns a unique lease ID.
 * release() and releaseError() are idempotent per lease — the second call
 * is a no-op and logs a DOUBLE_RELEASE warning with the lease ID.
 */
export class GroqScheduler {
  private static instance: GroqScheduler;

  private readonly maxConcurrency = 1;
  private activeRequests = 0;
  private leaseCounter = 0;
  private releasedLeases = new Set<number>();

  private readonly maxTpm = parseInt(process.env.GROQ_TPM_LIMIT || '8000', 10);
  private readonly safeTpmBudget: number;
  private readonly tokenWindowMs = 60000;
  private tokenHistory: { time: number; tokens: number; leaseId: number }[] = [];

  private waiters: Array<{ 
    estimatedTokens: number; 
    resolve: (value: number | PromiseLike<number>) => void; 
    reject: (err: Error) => void;
    maxWaitMs?: number; 
    docTag?: string;
    chunkNum?: number;
  }> = [];

  private constructor() {
    this.safeTpmBudget = Math.floor(this.maxTpm * 0.8);
  }

  public static getInstance(): GroqScheduler {
    if (!GroqScheduler.instance) {
      GroqScheduler.instance = new GroqScheduler();
    }
    return GroqScheduler.instance;
  }

  private cleanHistory() {
    const now = Date.now();
    this.tokenHistory = this.tokenHistory.filter(h => now - h.time < this.tokenWindowMs);
  }

  private getCurrentUsage(): number {
    this.cleanHistory();
    return this.tokenHistory.reduce((sum, h) => sum + h.tokens, 0);
  }

  /**
   * Acquire a scheduler slot. Returns a numeric leaseId that MUST be passed
   * to release() or releaseError(). Double-releasing the same leaseId is
   * detected and ignored (with a warning).
   */
  public acquire(estimatedTokens: number, signal?: AbortSignal, maxWaitMs?: number, docTag?: string, chunkNum?: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Cancelled"));
        return;
      }

      const waiter = { estimatedTokens, resolve, reject, maxWaitMs, docTag, chunkNum };
      this.waiters.push(waiter);

      if (signal) {
        const abortHandler = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) {
            this.waiters.splice(idx, 1);
          }
          reject(new Error("Cancelled"));
        };
        signal.addEventListener("abort", abortHandler, { once: true });

        // Clean up the abort listener when resolved
        const originalResolve = resolve;
        waiter.resolve = (leaseId: number | PromiseLike<number>) => {
          signal.removeEventListener("abort", abortHandler);
          originalResolve(leaseId);
        };
      }

      this.drainQueue();
    });
  }

  /**
   * Release a slot for a successful HTTP request.
   * actualTokensUsed: tokens reported by Groq usage.
   * leaseId: the ID returned by acquire().
   */
  public release(leaseId: number, actualTokensUsed: number, estimatedTokens: number) {
    if (this.releasedLeases.has(leaseId)) {
      console.error(`[PrivacyLens] DOUBLE_RELEASE leaseId=${leaseId} — ignoring`);
      return;
    }
    this.releasedLeases.add(leaseId);

    this.activeRequests--;

    // Correct token history: replace estimated with actual for this lease.
    for (let i = this.tokenHistory.length - 1; i >= 0; i--) {
      if (this.tokenHistory[i].leaseId === leaseId) {
        this.tokenHistory[i].tokens = actualTokensUsed;
        break;
      }
    }

    if (this.activeRequests < 0) {
      console.error(`[PrivacyLens] SCHEDULER INVARIANT VIOLATED: activeRequests went negative (leaseId=${leaseId})`);
      this.activeRequests = 0;
    }

    console.log(`[PrivacyLens] GROQ ACTIVE = ${this.activeRequests} (released leaseId=${leaseId})`);
    this.drainQueue();
  }

  /**
   * Release a slot for a failed HTTP request (error path).
   * Uses estimated tokens as the actual (conservative).
   */
  public releaseError(leaseId: number, estimatedTokens: number) {
    this.release(leaseId, estimatedTokens, estimatedTokens);
  }

  private drainQueue() {
    if (this.waiters.length === 0) return;
    if (this.activeRequests >= this.maxConcurrency) return;

    const usage = this.getCurrentUsage();
    const head = this.waiters[0];

    if ((usage + head.estimatedTokens) <= this.safeTpmBudget) {
      this.waiters.shift();
      const leaseId = ++this.leaseCounter;
      this.activeRequests++;
      this.tokenHistory.push({ time: Date.now(), tokens: head.estimatedTokens, leaseId });

      console.log(`[PrivacyLens] TPM ACQUIRED
  doc=${head.docTag}
  chunk=${head.chunkNum}
  leaseId=${leaseId}
  active=${this.activeRequests}`);

      if (this.activeRequests > 1) {
        console.error(`[PrivacyLens] CONCURRENCY INVARIANT VIOLATED: activeRequests=${this.activeRequests} (max=1)`);
      }

      head.resolve(leaseId);
    } else {
      // TPM budget exhausted — wait until enough tokens expire from history.
      const oldestEntry = this.tokenHistory[0];
      const waitMs = oldestEntry
        ? Math.max(100, this.tokenWindowMs - (Date.now() - oldestEntry.time))
        : 5000;

      if (head.maxWaitMs !== undefined && waitMs > head.maxWaitMs) {
        console.log(`[PrivacyLens] TPM WAIT REJECTED
  doc=${head.docTag}
  chunk=${head.chunkNum}
  reason=wait_exceeds_budget
  waitMs=${waitMs}
  remainingDocumentBudgetMs=${head.maxWaitMs}`);
        this.waiters.shift(); // remove from queue
        head.reject(new Error("TIMED_OUT_TPM_BUDGET"));
        this.drainQueue(); // process next in queue
        return;
      }

      console.log(`[PrivacyLens] TPM WAIT START
  doc=${head.docTag}
  chunk=${head.chunkNum}
  estimatedTokens=${head.estimatedTokens}
  remainingDocumentBudgetMs=${head.maxWaitMs}
  retryInMs=${waitMs}
  usage=${usage}
  budget=${this.safeTpmBudget}`);
      setTimeout(() => this.drainQueue(), waitMs);
    }
  }

  public get active(): number {
    return this.activeRequests;
  }

  /** Reset for testing only. */
  public _resetForTest() {
    this.activeRequests = 0;
    this.waiters = [];
    this.tokenHistory = [];
    this.releasedLeases.clear();
    this.leaseCounter = 0;
  }
}

export const globalScheduler = GroqScheduler.getInstance();
