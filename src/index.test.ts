import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "./index.ts";
import type { Env } from "./types.ts";

describe("worker routes", () => {
  it("serves the frontend from the root asset route", async () => {
    const env: Env = {
      ASSETS: {
        fetch: async () => new Response("frontend"),
      } as unknown as Fetcher,
    };

    const response = await worker.fetch(
      new Request("https://example.com/"),
      env,
      {} as ExecutionContext,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "frontend");
  });

  it("keeps the Bare instance endpoint separate from static assets", async () => {
    const env: Env = {
      ASSETS: {
        fetch: async () => new Response("frontend"),
      } as unknown as Fetcher,
    };

    const response = await worker.fetch(
      new Request("https://example.com/bare/"),
      env,
      {} as ExecutionContext,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as { versions: string[] };
    assert.deepEqual(body.versions, ["v3"]);
  });
});
