var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils.ts
var baseResponse = /* @__PURE__ */ __name((body, init) => {
  const r = new Response(body, init);
  r.headers.set("x-robots-tag", "noindex");
  r.headers.set("access-control-allow-headers", "*");
  r.headers.set("access-control-allow-origin", "*");
  r.headers.set("access-control-allow-methods", "*");
  r.headers.set("access-control-expose-headers", "*");
  r.headers.set("access-control-max-age", "7200");
  return r;
}, "baseResponse");
var json = /* @__PURE__ */ __name((j, status) => {
  return baseResponse(
    JSON.stringify(j),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}, "json");
var error = /* @__PURE__ */ __name((e, code, id, status = 500 /* InternalServerError */) => {
  const message = typeof e === "string" ? e : e.message ?? String(e);
  return json({
    code,
    id,
    message,
    stack: typeof e === "object" && e !== null ? e.stack : void 0
  }, status);
}, "error");

// package.json
var version = "0.0.1";
var repository = {
  type: "git",
  url: "https://github.com/akku1139/Infrared"
};

// src/instanceInfo.ts
var instanceInfo = /* @__PURE__ */ __name(async (r) => {
  return json({
    versions: [
      "v3"
    ],
    language: "ServiceWorker",
    project: {
      name: "infrared",
      description: "Infrared Bare Server",
      repository: repository.url,
      version
    }
  }, 200 /* OK */);
}, "instanceInfo");
var instanceInfo_default = instanceInfo;

// src/v3.ts
var forbiddenSendHeaders = [
  "connection",
  "content-length",
  "transfer-encoding"
];
var forbiddenForwardHeaders = [
  "connection",
  "transfer-encoding",
  "host",
  "origin",
  "referer"
];
var forbiddenPassHeaders = [
  "vary",
  "connection",
  "transfer-encoding",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
  "access-control-request-headers",
  "access-control-request-method"
];
var defaultForwardHeaders = ["accept-encoding", "accept-language"];
var defaultPassHeaders = [
  "content-encoding",
  "content-length",
  "last-modified"
];
var defaultCacheForwardHeaders = [
  "if-modified-since",
  "if-none-match",
  "cache-control"
];
var defaultCachePassHeaders = ["cache-control", "etag"];
var cacheNotModified = 304;
function readHeaders(request) {
  const sendHeaders = /* @__PURE__ */ Object.create(null);
  const passHeaders = [...defaultPassHeaders];
  const passStatus = [];
  const forwardHeaders = [...defaultForwardHeaders];
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
  let json2;
  try {
    json2 = JSON.parse(xBareHeaders);
  } catch (e) {
    throw new Error("Invalid JSON in X-Bare-Headers");
  }
  for (const [header, value] of Object.entries(json2)) {
    const lowerHeader = header.toLowerCase();
    if (forbiddenSendHeaders.includes(lowerHeader))
      continue;
    if (typeof value === "string") {
      sendHeaders[header] = value;
    } else if (Array.isArray(value)) {
      sendHeaders[header] = value;
    } else {
      throw new Error(`Invalid header value for ${header}`);
    }
  }
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
    forwardHeaders
  };
}
__name(readHeaders, "readHeaders");
function loadForwardedHeaders(forward, target, request) {
  for (const header of forward) {
    const value = request.headers.get(header);
    if (value !== null) {
      target[header] = value;
    }
  }
}
__name(loadForwardedHeaders, "loadForwardedHeaders");
var tunnelRequest = /* @__PURE__ */ __name(async (req) => {
  const abortController = new AbortController();
  const signal = abortController.signal;
  const { remote, sendHeaders, passHeaders, passStatus, forwardHeaders } = readHeaders(req);
  loadForwardedHeaders(forwardHeaders, sendHeaders, req);
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
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : void 0,
      signal
    });
    const responseHeaders = new Headers();
    for (const header of passHeaders) {
      const value = response.headers.get(header);
      if (value !== null) {
        responseHeaders.set(header, value);
      }
    }
    const status = passStatus.includes(response.status) ? response.status : 200 /* OK */;
    const headerObj = {};
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
      headers: responseHeaders
    });
  } catch (e) {
    if (signal.aborted) {
      throw new Error("Request aborted");
    }
    throw e;
  }
}, "tunnelRequest");
var tunnelSocket = /* @__PURE__ */ __name(async (req, env) => {
  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];
  const response = new Response(null, {
    status: 101,
    webSocket: client
  });
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-headers", "*");
  const connectPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for connect message"));
      server.close(4e3, "Connection timeout");
    }, 1e4);
    server.addEventListener("message", (event) => {
      clearTimeout(timeout);
      try {
        if (typeof event.data !== "string") {
          throw new TypeError("First WebSocket message must be text");
        }
        const message = JSON.parse(event.data);
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
  connectPromise.then(async (connectPacket) => {
    const headers = { ...connectPacket.headers };
    for (const header of connectPacket.forwardHeaders) {
      const value = req.headers.get(header);
      if (value !== null) {
        headers[header] = value;
      }
    }
    const remoteUrl = new URL(connectPacket.remote);
    if (!["ws:", "wss:"].includes(remoteUrl.protocol)) {
      throw new Error("Invalid WebSocket protocol");
    }
    const secKey = req.headers.get("sec-websocket-key");
    const secVersion = req.headers.get("sec-websocket-version");
    const secProtocol = req.headers.get("sec-websocket-protocol");
    if (secKey)
      headers["sec-websocket-key"] = secKey;
    if (secVersion)
      headers["sec-websocket-version"] = secVersion;
    if (secProtocol)
      headers["sec-websocket-protocol"] = secProtocol;
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
    const upgradeResponse = await fetch(remoteUrl.toString(), {
      headers: fetchHeaders,
      // @ts-ignore - duplex is needed for WebSocket but not in all types
      duplex: "half"
    });
    if (!upgradeResponse.webSocket) {
      throw new Error("Remote did not return a WebSocket");
    }
    const remoteSocket = upgradeResponse.webSocket;
    const setCookies = [];
    const setCookieHeader = upgradeResponse.headers.get("set-cookie");
    if (setCookieHeader) {
      setCookies.push(...setCookieHeader.split(", "));
    }
    const openMessage = {
      type: "open",
      protocol: remoteSocket.protocol || "",
      setCookies
    };
    server.send(JSON.stringify(openMessage));
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
  }).catch((e) => {
    console.error("WebSocket connection error:", e);
    if (server.readyState === WebSocket.CONNECTING) {
      server.close(4e3, e instanceof Error ? e.message : "Connection failed");
    } else if (server.readyState === WebSocket.OPEN) {
      server.close(1011, e instanceof Error ? e.message : "Connection error");
    }
  });
  return response;
}, "tunnelSocket");
var v3 = /* @__PURE__ */ __name(async (req, env) => {
  if (req.method === "OPTIONS") {
    return baseResponse(void 0, { status: 200 /* OK */ });
  }
  const upgrade = req.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    return tunnelSocket(req, env);
  }
  return tunnelRequest(req);
}, "v3");
var v3_default = v3;

// src/index.ts
var routes = {
  "": instanceInfo_default,
  "v3": v3_default
};
var src_default = {
  async fetch(r, env, ctx) {
    const path = new URL(r.url).pathname.split("/").filter(Boolean).slice(1).join("/");
    const route = routes[path];
    if (route === void 0) {
      return error(
        new Error("Not Found"),
        "UNKNOWN",
        "error.NotFoundError",
        404 /* NotFound */
      );
    }
    try {
      return await route(r, env);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return error(
        err,
        "UNKNOWN",
        "error." + err.name,
        500 /* InternalServerError */
      );
    }
  }
};
export {
  src_default as default
};
//# sourceMappingURL=_worker.js.map
