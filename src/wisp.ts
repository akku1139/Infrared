import { baseResponse, HTTPStatus } from "./utils";

const packetHeaderLength = 5;
const packetConnect = 0x01;
const packetData = 0x02;
const packetContinue = 0x03;
const packetClose = 0x04;
const packetInfo = 0x05;

const streamTcp = 0x01;
const streamUdp = 0x02;

const closeReasonUnspecified = 0x01;
const closeReasonVoluntary = 0x02;
const closeReasonNetwork = 0x03;
const closeReasonIncompatible = 0x04;
const closeReasonInvalidInfo = 0x41;
const closeReasonUnreachable = 0x42;
const closeReasonTimeout = 0x43;
const closeReasonRefused = 0x44;

const defaultBufferSize = 128;

interface WispPacket {
  type: number;
  streamId: number;
  payload: Uint8Array;
}

export interface WispTcpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close?: () => void;
}

export type WispTcpConnector = (
  hostname: string,
  port: number,
) => WispTcpSocket | Promise<WispTcpSocket>;

export interface WispWebSocket {
  accept(): void;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}

export interface WispOptions {
  connector?: WispTcpConnector;
  bufferSize?: number;
  accept?: boolean;
}

interface WispStream {
  id: number;
  socket: WispTcpSocket;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  receivedSinceContinue: number;
  closed: boolean;
}

function encodePacket(type: number, streamId: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const packet = new Uint8Array(packetHeaderLength + payload.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint8(0, type);
  view.setUint32(1, streamId, true);
  packet.set(payload, packetHeaderLength);
  return packet;
}

function decodePacket(data: Uint8Array): WispPacket {
  if (data.byteLength < packetHeaderLength) {
    throw new Error("Wisp packet is shorter than its header");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    type: view.getUint8(0),
    streamId: view.getUint32(1, true),
    payload: data.subarray(packetHeaderLength),
  };
}

function readUint32(payload: Uint8Array): number {
  if (payload.byteLength !== 4) {
    throw new Error("Wisp CONTINUE payload must be four bytes");
  }
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
}

function readInfo(payload: Uint8Array): void {
  if (payload.byteLength < 2) {
    throw new Error("Wisp INFO payload is incomplete");
  }
  if (payload[0] !== 2) {
    throw new Error("Unsupported Wisp protocol version");
  }

  let offset = 2;
  while (offset < payload.byteLength) {
    if (payload.byteLength - offset < 5) {
      throw new Error("Wisp INFO extension header is incomplete");
    }
    const length = new DataView(payload.buffer, payload.byteOffset + offset + 1, 4).getUint32(0, true);
    offset += 5;
    if (length > payload.byteLength - offset) {
      throw new Error("Wisp INFO extension payload is incomplete");
    }
    offset += length;
  }
}

function readConnect(payload: Uint8Array): { type: number; port: number; hostname: string } {
  if (payload.byteLength < 4) {
    throw new Error("Wisp CONNECT payload is incomplete");
  }

  const port = new DataView(payload.buffer, payload.byteOffset + 1, 2).getUint16(0, true);
  if (port === 0) {
    throw new Error("Wisp destination port is invalid");
  }

  let hostname: string;
  try {
    hostname = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payload.subarray(3));
  } catch {
    throw new Error("Wisp destination hostname is not valid UTF-8");
  }
  if (hostname.length === 0 || /[\u0000-\u001f\u007f]/.test(hostname)) {
    throw new Error("Wisp destination hostname is invalid");
  }

  return { type: payload[0], port, hostname };
}

async function readMessage(data: unknown): Promise<Uint8Array> {
  if (typeof data === "string") {
    throw new Error("Wisp packets must use binary WebSocket messages");
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("Unsupported Wisp WebSocket message data");
}

function closeReasonForError(error: unknown): number {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return closeReasonTimeout;
  if (message.includes("refused") || message.includes("econnrefused")) return closeReasonRefused;
  return closeReasonUnreachable;
}

async function cloudflareTcpConnector(hostname: string, port: number): Promise<WispTcpSocket> {
  const sockets = await import("cloudflare:sockets");
  const socket = sockets.connect({ hostname, port });
  await socket.opened;
  return socket;
}

class WispSession {
  private readonly streams = new Map<number, WispStream>();
  private readonly connector: WispTcpConnector;
  private readonly bufferSize: number;
  private readonly version2: boolean;
  private closed = false;
  private ready = false;
  private queue = Promise.resolve();

  constructor(
    private readonly socket: WispWebSocket,
    options: WispOptions,
    requestHasSubprotocol: boolean,
  ) {
    this.connector = options.connector ?? cloudflareTcpConnector;
    this.bufferSize = options.bufferSize ?? defaultBufferSize;
    this.version2 = requestHasSubprotocol;
  }

  async start(): Promise<void> {
    this.socket.addEventListener("message", (event) => {
      this.queue = this.queue.then(async () => {
        if (this.closed) return;
        try {
          await this.handleMessage(event.data);
        } catch {
          await this.fail(closeReasonUnspecified);
        }
      });
    });
    this.socket.addEventListener("close", () => {
      void this.closeAll();
    });
    this.socket.addEventListener("error", () => {
      void this.closeAll();
    });

    try {
      if (this.version2) {
        await this.send(packetInfo, 0, new Uint8Array([2, 1]));
      } else {
        await this.sendContinue(0);
        this.ready = true;
      }
    } catch {
      await this.fail(closeReasonNetwork);
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const packet = decodePacket(await readMessage(data));

    if (!this.ready) {
      if (!this.version2 || packet.type !== packetInfo || packet.streamId !== 0) {
        throw new Error("Wisp handshake is incomplete");
      }
      try {
        readInfo(packet.payload);
      } catch (error) {
        if (error instanceof Error && error.message === "Unsupported Wisp protocol version") {
          await this.fail(closeReasonIncompatible);
          return;
        }
        throw error;
      }
      this.ready = true;
      await this.sendContinue(0);
      return;
    }

    if (packet.type === packetConnect) {
      await this.openStream(packet);
      return;
    }
    if (packet.type === packetData) {
      await this.writeToStream(packet);
      return;
    }
    if (packet.type === packetClose) {
      await this.closeFromClient(packet);
      return;
    }

    throw new Error("Unknown Wisp packet type");
  }

  private async openStream(packet: WispPacket): Promise<void> {
    if (packet.streamId === 0) {
      await this.fail(closeReasonInvalidInfo);
      return;
    }
    if (this.streams.has(packet.streamId)) {
      await this.sendClose(packet.streamId, closeReasonInvalidInfo);
      return;
    }

    let destination: { type: number; port: number; hostname: string };
    try {
      destination = readConnect(packet.payload);
    } catch {
      await this.sendClose(packet.streamId, closeReasonInvalidInfo);
      return;
    }
    if (destination.type !== streamTcp && destination.type !== streamUdp) {
      await this.sendClose(packet.streamId, closeReasonInvalidInfo);
      return;
    }
    if (destination.type === streamUdp) {
      await this.sendClose(packet.streamId, closeReasonInvalidInfo);
      return;
    }

    let socket: WispTcpSocket;
    try {
      socket = await this.connector(destination.hostname, destination.port);
      if (socket.opened) await socket.opened;
    } catch (error) {
      await this.sendClose(packet.streamId, closeReasonForError(error));
      return;
    }

    if (this.closed) {
      socket.close?.();
      return;
    }

    let stream: WispStream;
    try {
      stream = {
        id: packet.streamId,
        socket,
        reader: socket.readable.getReader(),
        writer: socket.writable.getWriter(),
        receivedSinceContinue: 0,
        closed: false,
      };
    } catch {
      socket.close?.();
      await this.sendClose(packet.streamId, closeReasonNetwork);
      return;
    }

    this.streams.set(stream.id, stream);
    void this.readFromStream(stream);
  }

  private async writeToStream(packet: WispPacket): Promise<void> {
    const stream = this.streams.get(packet.streamId);
    if (!stream || stream.closed) {
      await this.sendClose(packet.streamId, closeReasonInvalidInfo);
      return;
    }

    try {
      await stream.writer.write(packet.payload);
      stream.receivedSinceContinue += 1;
      if (stream.receivedSinceContinue >= this.bufferSize) {
        stream.receivedSinceContinue = 0;
        await this.sendContinue(stream.id);
      }
    } catch {
      await this.closeStream(stream, closeReasonNetwork, true);
    }
  }

  private async closeFromClient(packet: WispPacket): Promise<void> {
    if (packet.payload.byteLength !== 1) {
      throw new Error("Wisp CLOSE payload must be one byte");
    }
    if (packet.streamId === 0) {
      await this.closeConnection();
      return;
    }

    const stream = this.streams.get(packet.streamId);
    if (stream) await this.closeStream(stream, packet.payload[0], false);
  }

  private async readFromStream(stream: WispStream): Promise<void> {
    let reason = closeReasonVoluntary;
    try {
      while (!this.closed && !stream.closed) {
        const result = await stream.reader.read();
        if (result.done) break;
        if (result.value.byteLength > 0) {
          await this.send(packetData, stream.id, result.value);
        }
      }
    } catch {
      reason = closeReasonNetwork;
    }
    await this.closeStream(stream, reason, true);
  }

  private async sendContinue(streamId: number): Promise<void> {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, this.bufferSize, true);
    await this.send(packetContinue, streamId, payload);
  }

  private async sendClose(streamId: number, reason: number): Promise<void> {
    await this.send(packetClose, streamId, new Uint8Array([reason]));
  }

  private async send(type: number, streamId: number, payload: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Wisp connection is closed");
    this.socket.send(encodePacket(type, streamId, payload));
  }

  private async closeStream(stream: WispStream, reason: number, notify: boolean): Promise<void> {
    if (stream.closed) return;
    stream.closed = true;
    this.streams.delete(stream.id);

    try {
      await stream.reader.cancel();
    } catch {
    }
    try {
      await stream.writer.abort();
    } catch {
    }
    stream.reader.releaseLock();
    stream.writer.releaseLock();
    stream.socket.close?.();

    if (notify && !this.closed) {
      try {
        await this.sendClose(stream.id, reason);
      } catch {
        await this.closeConnection();
      }
    }
  }

  private async closeAll(): Promise<void> {
    this.closed = true;
    const streams = [...this.streams.values()];
    await Promise.all(streams.map((stream) => this.closeStream(stream, closeReasonNetwork, false)));
  }

  private async closeConnection(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeAll();
    try {
      this.socket.close(1000, "Wisp connection closed");
    } catch {
    }
  }

  private async fail(reason: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.send(encodePacket(packetClose, 0, new Uint8Array([reason])));
    } catch {
    }
    await this.closeAll();
    try {
      this.socket.close(1002, "Wisp protocol error");
    } catch {
    }
  }
}

export async function handleWispWebSocket(
  socket: WispWebSocket,
  requestHasSubprotocol: boolean,
  options: WispOptions = {},
): Promise<void> {
  if (options.accept !== false) socket.accept();
  const session = new WispSession(socket, options, requestHasSubprotocol);
  await session.start();
}

const wisp: (request: Request, _env?: unknown, ctx?: ExecutionContext) => Promise<Response> = async (request, _env, ctx) => {
  if (request.method === "OPTIONS") {
    return baseResponse(undefined, { status: HTTPStatus.OK });
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return baseResponse("Expected a WebSocket upgrade", { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1] as unknown as WispWebSocket;
  server.accept();

  const setup = handleWispWebSocket(server, request.headers.has("sec-websocket-protocol"), { accept: false });
  if (ctx) ctx.waitUntil(setup);
  else void setup;

  const response = new Response(null, {
    status: HTTPStatus.SwitchingProtocols,
    webSocket: client,
  });
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-headers", "*");
  const requestedProtocol = request.headers.get("sec-websocket-protocol");
  if (requestedProtocol) {
    response.headers.set("sec-websocket-protocol", requestedProtocol.split(",", 1)[0].trim());
  }
  return response;
};

export { decodePacket, encodePacket, readConnect, readInfo, readUint32 };
export default wisp;
