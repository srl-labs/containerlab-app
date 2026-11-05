import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FabricApiError, type FabricIncomingMessage, type FabricOutgoingMessage, type FclingEvent } from "./engine";
import { createWebviewFabricClient } from "./webviewClient";

function fakeChannel() {
  const posted: FabricOutgoingMessage[] = [];
  let handler: ((event: MessageEvent<unknown>) => void) | undefined;
  return {
    posted,
    channel: {
      postMessage(message: unknown) {
        posted.push(message as FabricOutgoingMessage);
      },
      subscribe(next: (event: MessageEvent<unknown>) => void) {
        handler = next;
        return () => {};
      }
    },
    deliver(message: FabricIncomingMessage) {
      handler?.({ data: message } as MessageEvent<unknown>);
    }
  };
}

describe("createWebviewFabricClient", () => {
  test("answers a request with the response of the same id", async () => {
    const { channel, posted, deliver } = fakeChannel();
    const client = createWebviewFabricClient(channel);
    const first = client.api({ method: "GET", path: "status" });
    const second = client.engineStatus();
    assert.deepEqual(posted, [
      { type: "fabric:request", requestId: 1, op: "api", request: { method: "GET", path: "status" } },
      { type: "fabric:request", requestId: 2, op: "engine-status" }
    ]);
    deliver({ type: "fabric:response", requestId: 2, result: { state: "ready" } });
    deliver({ type: "fabric:response", requestId: 1, result: { fabric: "lab1" } });
    assert.deepEqual(await first, { fabric: "lab1" });
    assert.deepEqual(await second, { state: "ready" });
  });

  test("rejects with the status of a failed request", async () => {
    const { channel, deliver } = fakeChannel();
    const client = createWebviewFabricClient(channel);
    const call = client.startEngine();
    deliver({ type: "fabric:response", requestId: 1, error: "not running", status: 409 });
    await assert.rejects(call, (error: FabricApiError) => {
      assert.ok(error instanceof FabricApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message, "not running");
      return true;
    });
  });

  test("follows events from where asked, until closed", () => {
    const { channel, posted, deliver } = fakeChannel();
    const client = createWebviewFabricClient(channel);
    const seen: FclingEvent[] = [];
    let opened = 0;
    const close = client.openEvents(
      {
        onOpen: () => {
          opened += 1;
        },
        onEvent: (event) => seen.push(event)
      },
      { after: 5 }
    );
    assert.deepEqual(posted, [{ type: "fabric:events-start", streamId: 1, after: 5 }]);
    deliver({ type: "fabric:events-open", streamId: 1 });
    deliver({ type: "fabric:event", streamId: 1, event: { type: "change", seq: 6 } });
    close();
    assert.deepEqual(posted[1], { type: "fabric:events-stop", streamId: 1 });
    deliver({ type: "fabric:event", streamId: 1, event: { type: "change", seq: 7 } });
    assert.equal(opened, 1);
    assert.deepEqual(seen, [{ type: "change", seq: 6 }]);
  });

  test("reports a stream that ended, with its error", () => {
    const { channel, deliver } = fakeChannel();
    const client = createWebviewFabricClient(channel);
    const ended: Array<Error | undefined> = [];
    client.openEvents({ onEvent: () => {}, onClose: (error) => ended.push(error) });
    deliver({ type: "fabric:events-end", streamId: 1, error: "engine stopped" });
    assert.equal(ended[0]?.message, "engine stopped");
  });

  test("closing a stream that already ended posts nothing", () => {
    const { channel, posted, deliver } = fakeChannel();
    const close = createWebviewFabricClient(channel).openEvents({ onEvent: () => {} });
    deliver({ type: "fabric:events-end", streamId: 1 });
    close();
    assert.equal(posted.length, 1);
  });
});
