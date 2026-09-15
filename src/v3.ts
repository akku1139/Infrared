import type { Route, SocketClientToServer, SocketServerToClient, BareHeaders, Env } from "./types";
import { HTTPStatus, baseResponse, error } from "./utils";

// Forbidden headers that should not be sent to remote
const forbiddenSendHeaders = [
  "connection",
  "content-length",
  "transfer-encoding",
];

// Headers that should not be forwarded from client request
const forbiddenForwardHeaders = [
  "connection",
  "transfer-encoding",
  "host",
  "origin",
  "referer",
];

// Headers that should not be passed from remote response
const forbiddenPassHeaders = [
  "vary",
  "connection",
  "transfer-encoding",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
  "access-control-request-headers",
  "access-control-request-method",
];

// Default headers to forward
const defaultForwardHeaders: string[] = ["accept-encoding", "accept-language"];

// Default headers to pass from response
const defaultPassHeaders: string[] = [
  "content-encoding",
  "content-length",
  "last-modified",
];

// Additional headers when cache is enabled
const defaultCacheForwardHeaders: string[] = [
  "if-modified-since",
  "if-none-match",
  "cache-control",
];

const defaultCachePassHeaders: string[] = ["cache-control", "etag"];

const cacheNotModified = 304;

interface BareHeaderData {
  remote: URL;
  sendHeaders: BareHeaders;
  passHeaders: string[];
  passStatus: number[];
  forwardHeaders: string[];
}

const webSocketConnecting = 0;
const webSocketOpen = 1;
const webSocketClosed = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSocketMessage(data: unknown): SocketClientToServer {
  if (typeof data !== "string") {
    throw new TypeError("First WebSocket message must be text");
  }

  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    throw new TypeError("First WebSocket message must be valid JSON");
  }

  if (!isRecord(message) || message.type !== "connect") {
    throw new TypeError("Message type must be 'connect'");
  }
  if (typeof message.remote !== "string") {
    throw new TypeError("Connect message remote must be a string");
  }
  if (!Array.isArray(message.protocols) || !message.protocols.every((protocol) => typeof protocol === "string")) {
    throw new TypeError("Connect message protocols must be an array of strings");
  }
  if (!isRecord(message.headers)) {
    throw new TypeError("Connect message headers must be an object");
  }
  if (!Array.isArray(message.forwardHeaders) || !message.forwardHeaders.every((header) => typeof header === "string")) {
    throw new TypeError("Connect message forwardHeaders must be an array of strings");
  }

  const headers: BareHeaders = {};
  for (const [header, value] of Object.entries(message.headers)) {
    if (typeof value === "string") {
      headers[header] = value;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      headers[header] = value;
    } else {
      throw new TypeError(`Invalid header value for ${header}`);
    }
  }

  return {
    type: "connect",
    remote: message.remote,
    protocols: message.protocols,
    headers,
    forwardHeaders: message.forwardHeaders,
  };
}

function headersFromBareHeaders(headers: BareHeaders): Headers {
  const result = new Headers();
  for (const [header, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) result.append(header, entry);
    } else {
      result.set(header, value);
    }
  }
  return result;
}

function readHeaders(request: Request): BareHeaderData {
  const sendHeaders: BareHeaders = Object.create(null);
  const passHeaders = [...defaultPassHeaders];
  const passStatus: number[] = [];
  const forwardHeaders = [...defaultForwardHeaders];

  // Check if cache is enabled via query parameter
  const url = new URL(request.url);
  const cache = url.searchParams.has("cache");

  if (cache) {
    passHeaders.push(...defaultCachePassHeaders);
    passStatus.push(cacheNotModified);
    forwardHeaders.push(...defaultCacheForwardHeaders);
  }

  const xBareURL = request.headers.get("x-bare-url");
  if (!xBareURL) {
    throw new Error("Missing X-Bare-URL header");
  }

  const remote = new URL(xBareURL);
  if (!["http:", "https:"].includes(remote.protocol)) {
    throw new Error("Invalid protocol in X-Bare-URL");
  }

  const xBareHeaders = request.headers.get("x-bare-headers");
  if (!xBareHeaders) {
    throw new Error("Missing X-Bare-Headers header");
  }

  let json: Record<string, string | string[]>;
  try {
    json = JSON.parse(xBareHeaders);
  } catch (e) {
    throw new Error("Invalid JSON in X-Bare-Headers");
  }

  for (const [header, value] of Object.entries(json)) {
    const lowerHeader = header.toLowerCase();
    if (forbiddenSendHeaders.includes(lowerHeader)) continue;

    if (typeof value === "string") {
      sendHeaders[header] = value;
    } else if (Array.isArray(value)) {
      sendHeaders[header] = value;
    } else {
      throw new Error(`Invalid header value for ${header}`);
    }
  }

  // Handle X-Bare-Pass-Status
  const xBarePassStatus = request.headers.get("x-bare-pass-status");
  if (xBarePassStatus) {
    const parsed = xBarePassStatus.split(/,\s*/);
    for (const value of parsed) {
      const number = parseInt(value, 10);
      if (isNaN(number)) {
        throw new Error("Invalid status code in X-Bare-Pass-Status");
      }
      passStatus.push(number);
    }
  }

  // Handle X-Bare-Pass-Headers
  const xBarePassHeaders = request.headers.get("x-bare-pass-headers");
  if (xBarePassHeaders) {
    const parsed = xBarePassHeaders.split(/,\s*/);
    for (let header of parsed) {
      header = header.toLowerCase();
      if (forbiddenPassHeaders.includes(header)) {
        throw new Error(`Forbidden header in X-Bare-Pass-Headers: ${header}`);
      }
      passHeaders.push(header);
    }
  }

  // Handle X-Bare-Forward-Headers
  const xBareForwardHeaders = request.headers.get("x-bare-forward-headers");
  if (xBareForwardHeaders) {
    const parsed = xBareForwardHeaders.split(/,\s*/);
    for (let header of parsed) {
      header = header.toLowerCase();
      if (forbiddenForwardHeaders.includes(header)) {
        throw new Error(`Forbidden header in X-Bare-Forward-Headers: ${header}`);
      }
      forwardHeaders.push(header);
    }
  }

  return {
    remote,
    sendHeaders,
    passHeaders,
    passStatus,
    forwardHeaders,
  };
}

function loadForwardedHeaders(
  forward: string[],
  target: BareHeaders,
  request: Request
) {
  for (const header of forward) {
    const value = request.headers.get(header);
    if (value !== null) {
      target[header] = value;
    }
  }
}

// HTTP request handler
const tunnelRequest: Route = async (req) => {
  const abortController = new AbortController();
  
  // Handle connection close
  const signal = abortController.signal;

  const { remote, sendHeaders, passHeaders, passStatus, forwardHeaders } =
    readHeaders(req);

  loadForwardedHeaders(forwardHeaders, sendHeaders, req);

  // Convert headers to standard Headers object
  const fetchHeaders = new Headers();
  for (const [header, value] of Object.entries(sendHeaders)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        fetchHeaders.append(header, v);
      }
    } else {
      fetchHeaders.set(header, value);
    }
  }

  try {
    const fetchOptions: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers: fetchHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      signal,
    };
    if (fetchOptions.body) fetchOptions.duplex = "half";

    const response = await fetch(remote.toString(), fetchOptions);

    const responseHeaders = new Headers();

    // Pass specified headers from remote response
    for (const header of passHeaders) {
      const value = response.headers.get(header);
      if (value !== null) {
        responseHeaders.set(header, value);
      }
    }

    // Determine status code
    const status = passStatus.includes(response.status)
      ? response.status
      : HTTPStatus.OK;

    const headerObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerObj[key] = value;
    });

    if (status !== cacheNotModified) {
      responseHeaders.set("x-bare-status", response.status.toString());
      responseHeaders.set("x-bare-status-text", response.statusText);
      responseHeaders.set("x-bare-headers", JSON.stringify(headerObj));
    }

    return baseResponse(status === cacheNotModified ? null : response.body, {
      status,
      headers: responseHeaders,
    });
  } catch (e) {
    if (signal.aborted) {
      throw new Error("Request aborted");
    }
    throw e;
  }
};

const tunnelSocket = async (
  req: Request,
  _env: Env,
  ctx?: ExecutionContext,
): Promise<Response> => {
  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];
  server.accept();

  const response = new Response(null, {
    status: HTTPStatus.SwitchingProtocols,
    webSocket: client,
  });
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-headers", "*");

  const connectPromise = new Promise<SocketClientToServer>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      server.removeEventListener("message", onMessage);
      server.removeEventListener("error", onError);
      server.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent) => {
      cleanup();
      try {
        resolve(readSocketMessage(event.data));
      } catch (e) {
        reject(e);
      }
    };
    const onError = (event: Event) => {
      cleanup();
      reject(event);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Client closed connection before sending connect message"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for connect message"));
    }, 10000);

    server.addEventListener("message", onMessage);
    server.addEventListener("error", onError);
    server.addEventListener("close", onClose);
  });

  const setup = connectPromise.then(async (connectPacket) => {
    const remoteUrl = new URL(connectPacket.remote);
    if (!["ws:", "wss:"].includes(remoteUrl.protocol)) {
      throw new Error("Invalid WebSocket protocol");
    }

    const headers = headersFromBareHeaders(connectPacket.headers);
    for (const header of connectPacket.forwardHeaders) {
      const value = req.headers.get(header);
      if (value !== null) headers.set(header, value);
    }
    headers.set("upgrade", "websocket");
    headers.set("connection", "Upgrade");
    headers.delete("sec-websocket-protocol");
    if (connectPacket.protocols.length > 0) {
      headers.set("sec-websocket-protocol", connectPacket.protocols.join(", "));
    }

    const fetchUrl = new URL(remoteUrl);
    fetchUrl.protocol = remoteUrl.protocol === "ws:" ? "http:" : "https:";
    const upgradeResponse = await fetch(fetchUrl.toString(), { headers });
    if (!upgradeResponse.webSocket) {
      throw new Error("Remote did not return a WebSocket");
    }

    const remoteSocket = upgradeResponse.webSocket;
    remoteSocket.accept();

    const cookieHeaders = upgradeResponse.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies = cookieHeaders.getSetCookie?.() ?? [];
    if (setCookies.length === 0) {
      const setCookieHeader = upgradeResponse.headers.get("set-cookie");
      if (setCookieHeader) setCookies.push(setCookieHeader);
    }

    const openMessage: SocketServerToClient = {
      type: "open",
      protocol: remoteSocket.protocol || upgradeResponse.headers.get("sec-websocket-protocol") || "",
      setCookies,
    };
    server.send(JSON.stringify(openMessage));

    server.addEventListener("message", (event) => {
      if (remoteSocket.readyState === webSocketOpen) remoteSocket.send(event.data);
    });
    remoteSocket.addEventListener("message", (event) => {
      if (server.readyState === webSocketOpen) server.send(event.data);
    });
    server.addEventListener("close", (event) => {
      if (remoteSocket.readyState === webSocketOpen) remoteSocket.close(event.code, event.reason);
    });
    remoteSocket.addEventListener("close", (event) => {
      if (server.readyState === webSocketOpen) server.close(event.code, event.reason);
    });
    server.addEventListener("error", () => {
      if (remoteSocket.readyState === webSocketOpen) remoteSocket.close(1011, "Server error");
    });
    remoteSocket.addEventListener("error", () => {
      if (server.readyState === webSocketOpen) server.close(1011, "Remote error");
    });
  }).catch((e) => {
    const reason = e instanceof Error ? e.message : "Connection error";
    if (server.readyState === webSocketConnecting) server.accept();
    if (server.readyState !== webSocketClosed) server.close(1011, reason);
  });

  if (ctx) ctx.waitUntil(setup);
  return response;
};

const v3: Route = async (req, env, ctx) => {
  if (req.method === "OPTIONS") {
    return baseResponse(undefined, { status: HTTPStatus.OK });
  }

  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    return tunnelSocket(req, env ?? {}, ctx);
  }

  return tunnelRequest(req);
};

export default v3;
