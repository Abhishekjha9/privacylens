export class GroqScheduler {
  private static instance: GroqScheduler;
  private maxConcurrency = parseInt(process.env.GROQ_MAX_CONCURRENCY || '1', 10);
  private activeRequests = 0;
  
  private maxTpm = parseInt(process.env.GROQ_TPM_LIMIT || '8000', 10);
  private safeTpmBudget = Math.floor(this.maxTpm * 0.8);
  private tokenWindowMs = 60000;
  
  private tokenHistory: { time: number; tokens: number }[] = [];
  
  private queue: (() => void)[] = [];

  private constructor() {}

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

  public async acquire(estimatedTokens: number): Promise<void> {
    return new Promise(resolve => {
      const tryAcquire = () => {
        const usage = this.getCurrentUsage();
        
        if (this.activeRequests < this.maxConcurrency && (usage + estimatedTokens) <= this.safeTpmBudget) {
          this.activeRequests++;
          this.tokenHistory.push({ time: Date.now(), tokens: estimatedTokens });
          resolve();
        } else {
          // If we can't acquire, put back in queue to try later
          this.queue.push(tryAcquire);
          setTimeout(this.processQueue.bind(this), 500);
        }
      };
      
      this.queue.push(tryAcquire);
      this.processQueue();
    });
  }

  public release(actualTokensUsed?: number, estimatedTokens?: number) {
    this.activeRequests--;
    
    if (actualTokensUsed !== undefined && estimatedTokens !== undefined) {
      // Correct the history: replace the estimated token entry with the actual tokens
      // by finding the most recent entry that matches the estimate.
      for (let i = this.tokenHistory.length - 1; i >= 0; i--) {
        if (this.tokenHistory[i].tokens === estimatedTokens) {
          this.tokenHistory[i].tokens = actualTokensUsed;
          break;
        }
      }
    }
    
    this.processQueue();
  }

  private processQueue() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

export const globalScheduler = GroqScheduler.getInstance();
