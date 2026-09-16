import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "./index.ts";
import {
  encodePacket,
  handleWispWebSocket,
  type WispTcpConnector,
  type WispTcpSocket,
  type WispWebSocket,
} from "./wisp.ts";

class TestWebSocket implements WispWebSocket {
  readonly sent: Uint8Array[] = [];
  readonly listeners = new Map<string, ((event: any) => void)[]>();
  accepted = false;
  closed?: { code?: number; reason?: string };

  accept(): void {
    this.accepted = true;
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (data instanceof ArrayBuffer) {
      this.sent.push(new Uint8Array(data));
      return;
    }
    this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createSocket() {
  const received: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const socket: WispTcpSocket = {
    readable: new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(value) {
        received.push(new Uint8Array(value));
      },
    }),
  };
  return {
    socket,
    received,
    push(value: Uint8Array) {
      controller?.enqueue(value);
    },
    finish() {
      controller?.close();
    },
  };
}

describe("Wisp protocol", () => {
  it("routes /wisp/ and requires a WebSocket upgrade", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/wisp/"),
      {},
      {} as ExecutionContext,
    );

    assert.equal(response.status, 426);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });

  it("starts a v1 session and proxies a TCP stream", async () => {
    const webSocket = new TestWebSocket();
    const remote = createSocket();
    const connector: WispTcpConnector = async () => remote.socket;
    await handleWispWebSocket(webSocket, false, { connector, bufferSize: 8 });

    assert.equal(webSocket.accepted, true);
    assert.deepEqual(webSocket.sent[0], encodePacket(0x03, 0, new Uint8Array([8, 0, 0, 0])));

    const hostname = new TextEncoder().encode("example.com");
    const connectPayload = new Uint8Array(3 + hostname.byteLength);
    connectPayload[0] = 0x01;
    new DataView(connectPayload.buffer).setUint16(1, 443, true);
    connectPayload.set(hostname, 3);
    webSocket.emit("message", encodePacket(0x01, 7, connectPayload));
    await flush();

    webSocket.emit("message", encodePacket(0x02, 7, new TextEncoder().encode("hello")));
    await flush();
    assert.deepEqual(remote.received, [new TextEncoder().encode("hello")]);

    remote.push(new TextEncoder().encode("world"));
    await flush();
    assert.deepEqual(webSocket.sent[1], encodePacket(0x02, 7, new TextEncoder().encode("world")));

    webSocket.emit("message", encodePacket(0x04, 7, new Uint8Array([0x02])));
    await flush();
    assert.equal(webSocket.sent.length, 2);
  });

  it("performs the v2 INFO handshake before accepting streams", async () => {
    const webSocket = new TestWebSocket();
    const remote = createSocket();
    await handleWispWebSocket(webSocket, true, {
      connector: async () => remote.socket,
    });

    assert.deepEqual(webSocket.sent[0], encodePacket(0x05, 0, new Uint8Array([2, 1])));
    webSocket.emit("message", encodePacket(0x05, 0, new Uint8Array([2, 1])));
    await flush();
    assert.deepEqual(webSocket.sent[1], encodePacket(0x03, 0, new Uint8Array([128, 0, 0, 0])));
  });

  it("rejects an incompatible v2 handshake", async () => {
    const webSocket = new TestWebSocket();
    await handleWispWebSocket(webSocket, true, {
      connector: async () => createSocket().socket,
    });

    webSocket.emit("message", encodePacket(0x05, 0, new Uint8Array([1, 0])));
    await flush();

    assert.deepEqual(webSocket.sent[1], encodePacket(0x04, 0, new Uint8Array([0x04])));
    assert.equal(webSocket.closed?.code, 1002);
  });

  it("rejects UDP streams when the Worker transport has no UDP socket", async () => {
    const webSocket = new TestWebSocket();
    let connected = false;
    await handleWispWebSocket(webSocket, false, {
      connector: async () => {
        connected = true;
        return createSocket().socket;
      },
    });

    const hostname = new TextEncoder().encode("localhost");
    const payload = new Uint8Array(3 + hostname.byteLength);
    payload[0] = 0x02;
    new DataView(payload.buffer).setUint16(1, 53, true);
    payload.set(hostname, 3);
    webSocket.emit("message", encodePacket(0x01, 9, payload));
    await flush();

    assert.equal(connected, false);
    assert.deepEqual(webSocket.sent[1], encodePacket(0x04, 9, new Uint8Array([0x41])));
  });

  it("closes the WebSocket after a malformed packet", async () => {
    const webSocket = new TestWebSocket();
    await handleWispWebSocket(webSocket, false);
    webSocket.emit("message", new Uint8Array([0x02]));
    await flush();

    assert.deepEqual(webSocket.sent[1], encodePacket(0x04, 0, new Uint8Array([0x01])));
    assert.equal(webSocket.closed?.code, 1002);
  });
});
