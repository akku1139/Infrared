import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer, type WebSocket as NodeWebSocket } from "ws";
import { Miniflare } from "miniflare";

type BareClient = import("@tomphttp/bare-client").BareClient;

let bareClient: BareClient;
let mf: Miniflare;
let remote: WebSocketServer;
let remoteUrl: string;

class TestCloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
    super(type);
    this.code = init.code ?? 1000;
    this.reason = init.reason ?? "";
    this.wasClean = init.wasClean ?? this.code === 1000;
  }
}

class WorkerWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private socket?: CloudflareWebSocket;
  private state = WorkerWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    const httpUrl = String(url).replace(/^ws/, "http");
    void mf.dispatchFetch(httpUrl, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
      },
    }).then((response) => {
      if (!response.webSocket) throw new Error("Worker did not return a WebSocket");
      this.socket = response.webSocket as CloudflareWebSocket;
      this.socket.accept();
      this.state = WorkerWebSocket.OPEN;
      this.socket.addEventListener("message", (event) => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
      this.socket.addEventListener("close", (event) => {
        this.state = WorkerWebSocket.CLOSED;
        this.dispatchEvent(new TestCloseEvent("close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }));
      });
      this.socket.addEventListener("error", () => this.dispatchEvent(new Event("error")));
      this.dispatchEvent(new Event("open"));
    }).catch(() => {
      this.state = WorkerWebSocket.CLOSED;
      this.dispatchEvent(new Event("error"));
      this.dispatchEvent(new TestCloseEvent("close", { code: 1011, reason: "Worker connection failed" }));
    });
  }

  get readyState(): number {
    return this.state;
  }

  get protocol(): string {
    return "";
  }

  get url(): string {
    return "";
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (!this.socket) throw new DOMException("WebSocket is not open", "InvalidStateError");
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.state = WorkerWebSocket.CLOSING;
    this.socket?.close(code, reason);
  }
}

type CloudflareWebSocket = {
  accept(): void;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
};

function waitForEvent(target: EventTarget, type: string, timeoutMs = 5000): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(type, onEvent);
      reject(new Error(`Timed out waiting for ${type} event`));
    }, timeoutMs);
    const onEvent = (event: Event) => {
      clearTimeout(timer);
      resolve(event);
    };
    target.addEventListener(type, onEvent, { once: true });
  });
}

async function closeRemote(): Promise<void> {
  for (const client of remote.clients) client.close();
  remote.close();
  await once(remote, "close");
}

describe("v3 WebSocket handler", () => {
  before(async () => {
    mf = new Miniflare({
      name: "infrared-test",
      scriptPath: "./dist/_worker.js",
      compatibilityDate: "2024-01-01",
      compatibilityFlags: ["nodejs_compat"],
      modules: true,
      modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    });

    remote = new WebSocketServer({
      port: 0,
      host: "127.0.0.1",
      handleProtocols: (protocols) => protocols.has("echo") ? "echo" : false,
    });
    remote.on("connection", (socket: NodeWebSocket) => {
      socket.on("message", (message, isBinary) => socket.send(message, { binary: isBinary }));
    });
    await once(remote, "listening");
    const address = remote.address();
    if (!address || typeof address === "string") throw new Error("Unable to determine WebSocket server address");
    remoteUrl = `ws://127.0.0.1:${address.port}/echo`;

    globalThis.WebSocket = WorkerWebSocket as unknown as typeof WebSocket;
    const { BareClient } = await import("@tomphttp/bare-client");
    bareClient = new BareClient("http://localhost/bare/", { versions: ["v3"], language: "ServiceWorker" });
  });

  after(async () => {
    await closeRemote();
    await mf.dispose();
  });

  it("connects, negotiates a protocol, and forwards messages through bare-client", async () => {
    const socket = bareClient.createWebSocket(remoteUrl, ["echo"], {});
    const opened = waitForEvent(socket, "open");
    await opened;
    assert.equal(socket.protocol, "echo");

    const message = waitForEvent(socket, "message");
    socket.send("hello from bare-client");
    assert.equal((await message as MessageEvent).data, "hello from bare-client");

    const closed = waitForEvent(socket, "close");
    socket.close(1000, "done");
    await closed;
  });

  it("closes invalid connect requests instead of leaving them hanging", async () => {
    const socket = new WorkerWebSocket("ws://localhost/bare/v3/");
    await waitForEvent(socket, "open");
    const closed = waitForEvent(socket, "close");
    socket.send(JSON.stringify({ type: "connect", remote: "https://example.com" }));
    const event = await closed as TestCloseEvent;
    assert.notEqual(event.code, 1000);
  });
});
