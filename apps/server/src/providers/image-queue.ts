import { AbortedError } from "./http";

interface WaitingImage {
  readonly start: () => Promise<void>;
}

/** All image sources share one FIFO, including image download and decode. Never retries a paid call. */
class ImageGenerationQueue {
  private running = false;
  private readonly waiting: WaitingImage[] = [];

  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    return new Promise<T>((resolve, reject) => {
      const cancelWaiting = () => {
        const index = this.waiting.indexOf(entry);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        signal?.removeEventListener("abort", cancelWaiting);
        reject(new AbortedError());
      };
      const entry: WaitingImage = {
        start: async () => {
          signal?.removeEventListener("abort", cancelWaiting);
          try {
            if (signal?.aborted) throw new AbortedError();
            const result = await operation();
            if (signal?.aborted) throw new AbortedError();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            this.running = false;
            this.next();
          }
        },
      };
      this.waiting.push(entry);
      signal?.addEventListener("abort", cancelWaiting, { once: true });
      if (signal?.aborted) cancelWaiting();
      this.next();
    });
  }

  private next(): void {
    if (this.running) return;
    const entry = this.waiting.shift();
    if (!entry) return;
    this.running = true;
    void entry.start();
  }
}

export const imageGenerationQueue = new ImageGenerationQueue();
