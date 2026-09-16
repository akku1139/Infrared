import instanceInfo from "./instanceInfo";
import v3 from "./v3";
import wisp from "./wisp";

import type { Route, Env } from "./types";
import { error, HTTPStatus } from "./utils";

const bareRoutes = {
  "": instanceInfo,
  "v3": v3,
} satisfies { [path: string]: Route };

export default {
  async fetch(r: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(r.url).pathname;
    const isWisp = pathname === "/wisp" || pathname.startsWith("/wisp/");
    const path = pathname.replace(/^\/bare\/?|\/$/g, "");

    if (!isWisp && env.ASSETS && (pathname === "/" || !bareRoutes[path])) {
      const asset = await env.ASSETS.fetch(r);
      if (asset.status !== HTTPStatus.NotFound) return asset;
    }

    const route = isWisp ? wisp : bareRoutes[path];
    if (route === undefined) {
      return error(
        new Error("Not Found"),
        "UNKNOWN",
        "error.NotFoundError",
        HTTPStatus.NotFound
      );
    }

    try {
      return await route(r, env, ctx);
    } catch(e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      return error(
        err,
        "UNKNOWN",
        "error." + err.name,
        HTTPStatus.InternalServerError
      );
    }
  }
}

export type { Env };
