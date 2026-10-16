import WebSocket, { type RawData } from "ws";

import type { WiresharkVncSocket } from "./contract/backend.ts";

export function rawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

/** Adapts a `ws` WebSocket to the backend's socket facade. */
export function wrapWebSocket(socket: WebSocket): WiresharkVncSocket {
  return {
    send(data, isBinary) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data, { binary: isBinary });
      }
    },
    onOpen(listener) {
      socket.on("open", listener);
    },
    onMessage(listener) {
      socket.on("message", (data: RawData, isBinary: boolean) =>
        listener(isBinary ? rawDataToBytes(data) : Buffer.from(rawDataToBytes(data)).toString("utf8"), isBinary)
      );
    },
    onClose(listener) {
      socket.on("close", (code: number, reason: Buffer) => listener(code, reason.toString()));
    },
    onError(listener) {
      socket.on("error", listener);
    },
    close(code, reason) {
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
        return;
      }
      if (code !== undefined && isValidCloseCode(code)) {
        socket.close(code, reason);
        return;
      }
      socket.close();
    }
  };
}

/** Close codes an endpoint may send, per RFC 6455. */
export function isValidCloseCode(code: number): boolean {
  return (
    Number.isInteger(code) &&
    ((code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
      (code >= 3000 && code <= 4999))
  );
}
