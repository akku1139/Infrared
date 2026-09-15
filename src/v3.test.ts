import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { BareClient } from "@tomphttp/bare-client";
import v3 from "./v3.ts";
import type { Env } from "./types.ts";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine test server address");
  return `http://127.0.0.1:${address.port}/`;
}

async function close(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

async function readBody(request: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("v3 HTTP handler", () => {
  let upstream: Server;
  let proxy: Server;
  let upstreamUrl: string;
  let proxyUrl: string;
  let lastUpstreamHeaders: Record<string, string | string[] | undefined>;

  before(async () => {
    upstream = createServer(async (request, response) => {
      lastUpstreamHeaders = request.headers;
      const body = await readBody(request);
      response.writeHead(201, {
        "content-type": "application/json",
        "x-remote-header": "present",
      });
      response.end(JSON.stringify({ method: request.method, body: body.toString() }));
    });
    upstreamUrl = await listen(upstream);

    proxy = createServer(async (request, response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) headers.set(key, value.join(", "));
        else if (value !== undefined) headers.set(key, value);
      }
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readBody(request);
      const workerRequest = new Request(`http://127.0.0.1${request.url}`, {
        method: request.method,
        headers,
        body,
        duplex: "half",
      } as RequestInit);
      const workerResponse = await v3(workerRequest, {} as Env);
      response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    });
    proxyUrl = await listen(proxy);
  });

  after(async () => {
    await close(proxy);
    await close(upstream);
  });

  it("serves CORS preflight responses", async () => {
    const response = await v3(new Request("http://localhost/v3/", { method: "OPTIONS" }), {} as Env);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-methods"), "*");
  });

  it("fetches HTTP responses through the official bare-client", async () => {
    const client = new BareClient(proxyUrl, { versions: ["v3"], language: "ServiceWorker" });
    const response = await client.fetch(`${upstreamUrl}echo`, {
      headers: { accept: "application/json", "x-client-header": "present" },
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-remote-header"), "present");
    assert.deepEqual(await response.json(), { method: "GET", body: "" });
    assert.equal(lastUpstreamHeaders["x-client-header"], "present");
  });

  it("forwards request methods and bodies through the official bare-client", async () => {
    const client = new BareClient(proxyUrl, { versions: ["v3"], language: "ServiceWorker" });
    const response = await client.fetch(`${upstreamUrl}echo`, {
      method: "POST",
      body: "request body",
      headers: { "content-type": "text/plain" },
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { method: "POST", body: "request body" });
  });

  it("rejects malformed Bare request metadata before fetching upstream", async () => {
    await assert.rejects(
      async () => v3(new Request("http://localhost/v3/"), {} as Env),
      /Missing X-Bare-URL header/,
    );
    await assert.rejects(
      async () => v3(new Request("http://localhost/v3/", {
        headers: { "x-bare-url": `${upstreamUrl}echo`, "x-bare-headers": "invalid" },
      }), {} as Env),
      /Invalid JSON in X-Bare-Headers/,
    );
  });

  it("rejects forbidden forwarded and passed headers", async () => {
    const request = (name: string) => new Request("http://localhost/v3/", {
      headers: {
        "x-bare-url": `${upstreamUrl}echo`,
        "x-bare-headers": "{}",
        [name]: name === "x-bare-pass-headers" ? "connection" : "host",
      },
    });

    await assert.rejects(async () => v3(request("x-bare-pass-headers"), {} as Env), /Forbidden header/);
    await assert.rejects(async () => v3(request("x-bare-forward-headers"), {} as Env), /Forbidden header/);
  });
});
