import instanceInfo from "./instanceInfo";
import v3 from "./v3";

import type { Route, Env } from "./types";
import { error, HTTPStatus } from "./utils";

const routes = {
  "": instanceInfo,
  "v3": v3,
} satisfies { [path: string]: Route };

export default {
  async fetch(r: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(r.url).pathname.replace(/^\/|\/$/g, '');
    const route = routes[path];

    if(route === undefined) {
      return error(
        new Error("Not Found"),
        "UNKNOWN",
        "error.NotFoundError",
        HTTPStatus.NotFound
      );
    }

    try {
      return await route(r, env);
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
