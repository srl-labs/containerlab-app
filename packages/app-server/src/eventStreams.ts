/**
 * The app's live event streams: lab events, workspace file changes and the
 * open topology's document events. Each one is served as an SSE route and
 * over the event channel WebSocket (`eventChannel.ts`), which carries every
 * stream of a browser tab.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import {
  disableStreamTimeouts,
  startSseHeartbeat,
  streamResponseHeaders,
} from "./streamResponseHeaders.ts";

/** Refuses a stream before it opens, with the HTTP status the SSE route answers. */
export class EventStreamRefusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EventStreamRefusal";
    this.status = status;
  }
}

export interface EventStreamParams {
  endpointId?: string;
  sessionId?: string;
}

/** An accepted stream. */
export interface EventStream {
  /** Starts the stream; yields the `data` of each event. */
  open(signal: AbortSignal): Promise<AsyncIterable<string>>;
  /** Reported when the stream fails without a message. */
  failureMessage: string;
  /** Runs once the stream has ended. */
  release?(): void;
}

/** Checks a request for a stream: accepts it, or throws an `EventStreamRefusal`. */
export type EventStreamSource = (
  request: FastifyRequest,
  reply: FastifyReply,
  params: EventStreamParams,
) => EventStream;

export interface EventStreamSink {
  event(data: string): void;
  error(message: string): void;
}

/** Forwards a stream's events until it ends, fails or `signal` aborts. */
export async function pumpEventStream(
  stream: EventStream,
  signal: AbortSignal,
  sink: EventStreamSink,
): Promise<void> {
  try {
    const events = await stream.open(signal);
    for await (const data of events) {
      if (signal.aborted) break;
      sink.event(data);
    }
  } catch (error) {
    if (!signal.aborted) {
      sink.error(error instanceof Error ? error.message : stream.failureMessage);
    }
  } finally {
    stream.release?.();
  }
}

/** Serves a stream as Server-Sent Events. */
export async function sendSseEventStream(
  request: FastifyRequest,
  reply: FastifyReply,
  source: EventStreamSource,
  params: EventStreamParams,
): Promise<FastifyReply | undefined> {
  let stream: EventStream;
  try {
    stream = source(request, reply, params);
  } catch (error) {
    if (error instanceof EventStreamRefusal) {
      return reply.status(error.status).send({ error: error.message });
    }
    throw error;
  }

  const abortController = new AbortController();
  const abort = (): void => abortController.abort();
  let stopHeartbeat: (() => void) | undefined;
  try {
    disableStreamTimeouts(request, reply);
    reply.raw.writeHead(
      200,
      streamResponseHeaders(request, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      }),
    );
    // An initial comment establishes the connection.
    reply.raw.write(":ok\n\n");
    stopHeartbeat = startSseHeartbeat(reply);
    reply.raw.on("close", abort);
  } catch (error) {
    stream.release?.();
    throw error;
  }

  let eventId = 0;
  await pumpEventStream(stream, abortController.signal, {
    event(data) {
      eventId += 1;
      reply.raw.write(`id: ${eventId}\ndata: ${data}\n\n`);
    },
    error(message) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    },
  });
  stopHeartbeat();
  reply.raw.off("close", abort);
  if (!abortController.signal.aborted && !reply.raw.writableEnded) {
    reply.raw.end();
  }
  return undefined;
}
