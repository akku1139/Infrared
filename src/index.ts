import instanceInfo from "./instanceInfo.ts";
import v3 from "./v3.ts";

import type { Route } from "./types.ts";
import { error, HTTPStatus } from "./utils.js";

const routes = {
  "": instanceInfo,
  "v3": v3,
} satisfies { [path: string]: Route };

export default {
  async fetch(r: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const path = new URL(r.url).pathname.replace(/^\/bare\/?(.*)\/?$/, "$1");
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
      return route(r);
    } catch(e: Error) {
      return error(
        e,
        "UNKNOWN",
        "error." + e.name,
        HTTPStatus.InternalServerError
      );
    }
  }
}

export interface Env {}
