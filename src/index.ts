import instanceInfo from "./instanceInfo.ts";
import v3 from "./v3.ts";

import type { Route } from "./types.ts";

const routes = {
  "": instanceInfo,
  "v3": v3,
} satisfies { [path: string]: Route };

export default {
  async fetch(r: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(r.url).pathname.replace(/^\/bare\/?(.*)\/?$/, "$1");
    return routes[path](r);
  }
}

export interface Env {}
