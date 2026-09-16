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
    setTimeout,
    clearTimeout,
    location: {
      origin: "https://proxy.example",
      href: "https://proxy.example/",
    },
    addEventListener(type: string, listener: (event: any) => void) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
  };
  scope.self = scope;
  scope.importScripts = () => runInContext(proxyUrlSource, context);
  const context = createContext(scope);
  runInContext(serviceWorkerSource, context);
  return { scope, listeners };
}

describe("proxy service worker", () => {
  it("routes encoded service URLs to Bare and rewrites HTML links", async () => {
    let bareRequest: Request | undefined;
    const worker = createWorker(async (input, init) => {
      bareRequest = new Request(input, init);
      return new Response(
        '<html><head><style>body{background:url("/images/bg.png")}</style></head><body><a href="/next">next</a><img src="images/logo.svg"><form action="/submit"></form><img srcset="/small.png 1x, /large.png 2x"></body></html>',
        {
          status: 200,
          headers: {
            "X-Bare-Status": "200",
            "X-Bare-Status-Text": "OK",
            "X-Bare-Headers": JSON.stringify({ "content-type": "text/html" }),
          },
        },
      );
    });
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
    const body = await response.text();
    assert.equal(bareRequest?.url, "https://proxy.example/bare/v3");
    assert.equal(bareRequest?.headers.get("X-Bare-URL"), target);
    assert.match(body, /\/service\//);
    assert.match(body, /next/);
    assert.doesNotMatch(body, /href="\/next"/);
    assert.doesNotMatch(body, /src="images\/logo\.svg"/);
    assert.equal(response.headers.get("X-Infrared-Proxy"), "bare-v3");
  });

  it("rewrites CSS resources and preserves non-proxy requests", async () => {
    let fetchCount = 0;
    const worker = createWorker(async () => {
      fetchCount += 1;
      return new Response("body { background: url(/image.png) }", {
        headers: {
          "X-Bare-Headers": JSON.stringify({ "content-type": "text/css" }),
        },
      });
    });

    let responsePromise: Promise<Response> | undefined;
    worker.listeners.get("fetch")!({
      request: new Request(`https://proxy.example/service/${worker.scope.infraredProxy.encode("https://example.com/assets/site.css")}`),
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
    });
    const response = await responsePromise!;
    assert.match(await response.text(), /\/service\//);
    assert.equal(fetchCount, 1);

    let intercepted = false;
    worker.listeners.get("fetch")!({
      request: new Request("https://proxy.example/app.js"),
      respondWith() {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false);
  });
});
