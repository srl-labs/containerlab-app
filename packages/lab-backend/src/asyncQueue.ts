/**
 * Turns pushed values into an async iterable that ends when `end()` is called
 * or `signal` aborts. Iterating stops pending pushes from piling up forever:
 * returning early calls `onReturn` so the producer can stop.
 */
export function createAsyncQueue<T>(
  signal: AbortSignal,
  onReturn: () => void
): { push(value: T): void; fail(error: unknown): void; end(): void; iterable: AsyncIterable<T> } {
  const values: T[] = [];
  let ended = false;
  let failure: unknown;
  let failed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  const end = () => {
    ended = true;
    notify();
  };
  signal.addEventListener("abort", end, { once: true });

  async function* iterate(): AsyncGenerator<T> {
    try {
      while (true) {
        if (values.length > 0) {
          yield values.shift() as T;
          continue;
        }
        if (failed) throw failure;
        if (ended || signal.aborted) return;
        await new Promise<void>((resume) => {
          wake = resume;
        });
      }
    } finally {
      signal.removeEventListener("abort", end);
      onReturn();
    }
  }

  return {
    push(value) {
      if (ended) return;
      values.push(value);
      notify();
    },
    fail(error) {
      failure = error;
      failed = true;
      notify();
    },
    end,
    iterable: iterate()
  };
}
