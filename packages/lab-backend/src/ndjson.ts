/** Splits a byte stream into trimmed, non-empty lines. */
export async function* readLines(
  body: AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: AsyncIterable<Uint8Array | string> =
    Symbol.asyncIterator in body
      ? (body as AsyncIterable<Uint8Array | string>)
      : readableStreamChunks(body as ReadableStream<Uint8Array>);
  for await (const chunk of chunks) {
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

async function* readableStreamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
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

/** Parses NDJSON records, skipping lines that are not JSON objects. */
export async function* readJsonLines<T>(
  body: AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>
): AsyncGenerator<T> {
  for await (const line of readLines(body)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value === "object" && value !== null) yield value as T;
  }
}
