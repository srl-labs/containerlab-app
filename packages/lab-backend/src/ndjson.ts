type ByteSource = AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>;

/**
 * Starts reading `body` now rather than at the first `next()`. undici cancels
 * the body of a fetch Response that was garbage collected while its stream was
 * not locked, and the Response is gone once only its body is kept: a stream
 * handed out to be read later (an events stream read after a deploy) would end
 * early, silently, at whatever moment the collector runs.
 */
function startReading(body: ByteSource): AsyncIterator<Uint8Array | string> {
  if (Symbol.asyncIterator in body) {
    return (body as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator]();
  }
  return readerChunks((body as ReadableStream<Uint8Array>).getReader());
}

async function* readerChunks(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Uint8Array> {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Splits a byte stream into trimmed, non-empty lines. The stream is read from the call on. */
export function readLines(body: ByteSource): AsyncGenerator<string> {
  return linesOf(startReading(body));
}

async function* linesOf(chunks: AsyncIterator<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of { [Symbol.asyncIterator]: () => chunks }) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }
  buffer += decoder.decode();
  const rest = buffer.trim();
  if (rest) yield rest;
}

/** The part of a web stream `withIdleTimeout` reads, so DOM and Node streams both fit. */
interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
  };
}

/**
 * Reads a stream that the lab host keeps alive with heartbeats, and fails
 * when nothing arrives for `idleMs`: the host went away without closing
 * the connection. The stream is read from the call on (see `startReading`).
 */
export function withIdleTimeout(stream: ByteStream, idleMs: number): AsyncGenerator<Uint8Array> {
  return idleChunks(stream.getReader(), idleMs);
}

async function* idleChunks(reader: ReturnType<ByteStream["getReader"]>, idleMs: number): AsyncGenerator<Uint8Array> {
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No data from the lab host for ${Math.round(idleMs / 1000)} s`)),
          idleMs
        );
      });
      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await Promise.race([reader.read(), idle]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) return;
      if (result.value) yield result.value;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Parses NDJSON records, skipping lines that are not JSON objects. The stream is read from the call on. */
export function readJsonLines<T>(body: ByteSource): AsyncGenerator<T> {
  return jsonRecords<T>(readLines(body));
}

async function* jsonRecords<T>(lines: AsyncIterable<string>): AsyncGenerator<T> {
  for await (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value === "object" && value !== null) yield value as T;
  }
}
