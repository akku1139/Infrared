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
    const response = await fetch(remote.toString(), {
      method: req.method,
      headers: fetchHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      signal,
    });

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

// WebSocket handler for Cloudflare Pages
const tunnelSocket = async (req: Request, env: Env): Promise<Response> => {
  // Create WebSocket pair for proxying
  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];

  // Accept the WebSocket connection
  const response = new Response(null, {
    status: 101,
    webSocket: client,
  });
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-headers", "*");

  // Wait for the first message containing connection info
  const connectPromise = new Promise<SocketClientToServer>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for connect message"));
      server.close(4000, "Connection timeout");
    }, 10000);

    server.addEventListener("message", (event) => {
      clearTimeout(timeout);
      try {
        if (typeof event.data !== "string") {
          throw new TypeError("First WebSocket message must be text");
        }
        const message = JSON.parse(event.data) as SocketClientToServer;
        if (message.type !== "connect") {
          throw new TypeError("Message type must be 'connect'");
        }
        resolve(message);
      } catch (e) {
        reject(e);
      }
    });

    server.addEventListener("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    
    server.addEventListener("close", () => {
      clearTimeout(timeout);
      reject(new Error("Client closed connection before sending connect message"));
    });
  });

  // Process the connection
  connectPromise
    .then(async (connectPacket) => {
      // Load forwarded headers
      const headers: BareHeaders = { ...connectPacket.headers };
      for (const header of connectPacket.forwardHeaders) {
        const value = req.headers.get(header);
        if (value !== null) {
          headers[header] = value;
        }
      }

      // Add required WebSocket headers
      const remoteUrl = new URL(connectPacket.remote);
      if (!["ws:", "wss:"].includes(remoteUrl.protocol)) {
        throw new Error("Invalid WebSocket protocol");
      }

      // Copy Sec-WebSocket-Key and Sec-WebSocket-Version from original request
      const secKey = req.headers.get("sec-websocket-key");
      const secVersion = req.headers.get("sec-websocket-version");
      const secProtocol = req.headers.get("sec-websocket-protocol");
      
      if (secKey) headers["sec-websocket-key"] = secKey;
      if (secVersion) headers["sec-websocket-version"] = secVersion;
      if (secProtocol) headers["sec-websocket-protocol"] = secProtocol;
      
      headers["Host"] = remoteUrl.host;

      const fetchHeaders = new Headers();
      for (const [header, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            fetchHeaders.append(header, v);
          }
        } else {
          fetchHeaders.set(header, value);
        }
      }

      // Use upgrade fetch for WebSocket with duplex option
      const upgradeResponse = await fetch(remoteUrl.toString(), {
        headers: fetchHeaders,
        // @ts-ignore - duplex is needed for WebSocket but not in all types
        duplex: "half",
      });

      if (!upgradeResponse.webSocket) {
        throw new Error("Remote did not return a WebSocket");
      }

      const remoteSocket = upgradeResponse.webSocket;

      // Send open message to client
      const setCookies: string[] = [];
      const setCookieHeader = upgradeResponse.headers.get("set-cookie");
      if (setCookieHeader) {
        setCookies.push(...setCookieHeader.split(", "));
      }

      const openMessage: SocketServerToClient = {
        type: "open",
        protocol: remoteSocket.protocol || "",
        setCookies,
      };

      server.send(JSON.stringify(openMessage));

      // Set up bidirectional message forwarding
      server.accept();
      remoteSocket.accept();

      server.addEventListener("message", (event) => {
        if (remoteSocket.readyState === WebSocket.OPEN) {
          remoteSocket.send(event.data);
        }
      });

      remoteSocket.addEventListener("message", (event) => {
        if (server.readyState === WebSocket.OPEN) {
          server.send(event.data);
        }
      });

      server.addEventListener("close", (event) => {
        if (remoteSocket.readyState === WebSocket.OPEN) {
          remoteSocket.close(event.code, event.reason);
        }
      });

      remoteSocket.addEventListener("close", (event) => {
        if (server.readyState === WebSocket.OPEN) {
          server.close(event.code, event.reason);
        }
      });

      server.addEventListener("error", () => {
        if (remoteSocket.readyState === WebSocket.OPEN) {
          remoteSocket.close(1011, "Server error");
        }
      });

      remoteSocket.addEventListener("error", () => {
        if (server.readyState === WebSocket.OPEN) {
          server.close(1011, "Remote error");
        }
      });
    })
    .catch((e) => {
      console.error("WebSocket connection error:", e);
      if (server.readyState === WebSocket.CONNECTING) {
        // Connection failed before accept, close with error
        server.close(4000, e instanceof Error ? e.message : "Connection failed");
      } else if (server.readyState === WebSocket.OPEN) {
        server.close(1011, e instanceof Error ? e.message : "Connection error");
      }
    });

  return response;
};

const v3: Route = async (req, env) => {
  if (req.method === "OPTIONS") {
    return baseResponse(undefined, { status: HTTPStatus.OK });
  }

  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    return tunnelSocket(req, env);
  }

  return tunnelRequest(req);
};

export default v3;
