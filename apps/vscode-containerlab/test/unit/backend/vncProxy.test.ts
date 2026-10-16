/* global describe, it */
import { expect } from "chai";
import WebSocket from "ws";

import { startVncProxy } from "../../../src/backend/vncProxy";

type Listener<T extends unknown[]> = (...args: T) => void;

/** A Wireshark VNC session on a lab server: one page, and a socket that echoes. */
function fakeBackend() {
  const requests: {
    sessionId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
  }[] = [];
  const sockets: { sessionId: string; path: string; protocols: string[]; sent: string[] }[] = [];
  const backend = {
    async fetchWiresharkVnc(
      sessionId: string,
      request: { method: string; path: string; headers: Record<string, string> }
    ) {
      requests.push({ sessionId, ...request });
      return {
        status: 200,
        headers: [
          ["content-type", "text/html"],
          ["content-encoding", "gzip"],
          ["content-length", "999"]
        ] as Array<[string, string]>,
        body: new TextEncoder().encode("<title>noVNC</title>")
      };
    },
    connectWiresharkVnc(sessionId: string, path: string, options: { protocols: string[] }) {
      const record = { sessionId, path, protocols: options.protocols, sent: [] as string[] };
      sockets.push(record);
      const open: Listener<[]>[] = [];
      const message: Listener<[Uint8Array | string, boolean]>[] = [];
      setTimeout(() => open.forEach((listener) => listener()), 20);
      return {
        send(data: Uint8Array | string, isBinary: boolean) {
          const text = typeof data === "string" ? data : Buffer.from(data).toString();
          record.sent.push(text);
          message.forEach((listener) => listener(`echo:${text}`, isBinary));
        },
        onOpen: (listener: Listener<[]>) => open.push(listener),
        onMessage: (listener: Listener<[Uint8Array | string, boolean]>) => message.push(listener),
        onClose: () => {},
        onError: () => {},
        close: () => {}
      };
    }
  };
  return { backend, requests, sockets };
}

describe("startVncProxy", () => {
  it("serves the session's pages with the decoded body and without credentials", async () => {
    const { backend, requests } = fakeBackend();
    const proxy = await startVncProxy(backend as never, "session-1");
    try {
      const response = await fetch(`${proxy.url}vnc.html?autoconnect=1`, {
        headers: { Authorization: "Bearer leaked" }
      });
      expect(response.status).to.equal(200);
      expect(response.headers.get("content-encoding")).to.equal(null);
      expect(await response.text()).to.equal("<title>noVNC</title>");
      expect(requests).to.have.lengthOf(1);
      expect(requests[0].sessionId).to.equal("session-1");
      expect(requests[0].path).to.equal("/vnc.html?autoconnect=1");
      expect(Object.keys(requests[0].headers).map((key) => key.toLowerCase())).to.not.include(
        "authorization"
      );
    } finally {
      proxy.close();
    }
  });

  it("bridges the VNC WebSocket, including messages sent before the server answers", async () => {
    const { backend, sockets } = fakeBackend();
    const proxy = await startVncProxy(backend as never, "session-2");
    try {
      const client = new WebSocket(`${proxy.url.replace("http", "ws")}websockify?token=1`, [
        "binary"
      ]);
      const reply = new Promise<string>((resolve, reject) => {
        client.on("message", (data) => resolve(String(data)));
        client.on("error", reject);
      });
      await new Promise<void>((resolve) => client.on("open", () => resolve()));
      client.send("hello");
      expect(await reply).to.equal("echo:hello");
      expect(sockets[0].path).to.equal("/websockify?token=1");
      expect(sockets[0].protocols).to.deep.equal(["binary"]);
      client.close();
    } finally {
      proxy.close();
    }
  });
});
