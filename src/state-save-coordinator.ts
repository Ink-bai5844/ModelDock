export type StateSaveFunction<T> = (state: T) => Promise<void>;

interface PendingState<T> {
  sequence: number;
  digest: string;
  state: T;
}

async function contentDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class StateSaveCoordinator<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private pending: PendingState<T> | undefined;
  private lastSavedDigest: string | undefined;
  private sequence = 0;
  private preparing = 0;
  private streaming = false;
  private disposed = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly save: StateSaveFunction<T>,
    private readonly onBackgroundError: (error: unknown) => void = () => undefined,
  ) {}

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    if (streaming && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.notifyIdle();
    }
  }

  schedule(state: T, delayMilliseconds: number): void {
    if (this.disposed || this.streaming) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(state).catch(this.onBackgroundError);
    }, Math.max(0, delayMilliseconds));
  }

  async flush(state: T): Promise<void> {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.enqueue(state);
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.notifyIdle();
  }

  private async enqueue(state: T): Promise<void> {
    const sequence = ++this.sequence;
    this.preparing += 1;
    let digest: string;
    try {
      digest = await contentDigest(state);
    } finally {
      this.preparing -= 1;
    }
    if (digest === this.lastSavedDigest) {
      this.notifyIdle();
      return;
    }
    if (!this.pending || sequence >= this.pending.sequence) {
      this.pending = { sequence, digest, state };
    }
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = undefined;
        this.notifyIdle();
      });
    }
    await this.running;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const next = this.pending;
      this.pending = undefined;
      if (next.digest === this.lastSavedDigest) continue;
      await this.save(next.state);
      this.lastSavedDigest = next.digest;
    }
  }

  private isIdle(): boolean {
    return !this.timer && !this.running && !this.pending && this.preparing === 0;
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
