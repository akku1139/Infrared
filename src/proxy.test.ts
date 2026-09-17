import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "../public");
const proxyUrlSource = readFileSync(join(publicDirectory, "proxy-url.js"), "utf8");
const serviceWorkerSource = readFileSync(join(publicDirectory, "proxy-sw.js"), "utf8");

function createWorker(fetchImpl: typeof fetch) {
  const listeners = new Map<string, (event: any) => void>();
  const scope: Record<string, any> = {
    URL,
    Headers,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    console,
    fetch: fetchImpl,
    location: {
      origin: "https://proxy.example",
      href: "https://proxy.example/",
    },
    addEventListener(type: string, listener: (event: any) => void) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
    Ultraviolet: {
      codec: {
        xor: {
          encode(value: string) {
            return encodeURIComponent(value);
          },
          decode(value: string) {
            return decodeURIComponent(value);
          },
        },
      },
    },
    '__uv$config': {
      encodeUrl(value: string) {
        return encodeURIComponent(value);
      },
      decodeUrl(value: string) {
        return decodeURIComponent(value);
      },
    },
  };
  scope.self = scope;
  scope.importScripts = () => {};
  scope.UVServiceWorker = class {
    route(event: any) {
      return event.request.url.startsWith("https://proxy.example/service/");
    }

    async fetch(event: any) {
      return fetchImpl("https://proxy.example/bare/v3", {
        method: event.request.method,
        headers: { "X-UV-Routed": "true" },
      });
    }
  };
  const context = createContext(scope);
  runInContext(proxyUrlSource, context);
  runInContext(serviceWorkerSource, context);
  return { scope, listeners };
}

describe("proxy service worker", () => {
  it("delegates encoded service URLs to the official UV runtime", async () => {
    const worker = createWorker(async (_input, init) => new Response("proxied", {
      headers: init?.headers,
    }));
    const target = "https://example.com/start/index.html";
    const encoded = worker.scope.infraredProxy.encode(target);
    let responsePromise: Promise<Response> | undefined;
    worker.listeners.get("fetch")!({
      request: new Request(`https://proxy.example/service/${encoded}`),
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
    });

    const response = await responsePromise!;
    assert.equal(await response.text(), "proxied");
    assert.equal(response.headers.get("X-UV-Routed"), "true");
  });

  it("passes non-service requests through the official UV runtime", async () => {
    let fetchCount = 0;
    const worker = createWorker(async (input) => {
      fetchCount += 1;
      const requestUrl = typeof input === "string" ? input : input.url;
      return new Response(new URL(requestUrl).pathname);
    });
    let responsePromise: Promise<Response> | undefined;
    worker.listeners.get("fetch")!({
      request: new Request("https://proxy.example/app.js"),
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
    });

    assert.equal(await (await responsePromise!).text(), "/app.js");
    assert.equal(fetchCount, 1);
  });
});
