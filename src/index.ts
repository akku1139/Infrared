import instanceInfo from "./instanceInfo.ts";
import V3 from "./V3.ts";

import type { Route } from "./types.ts";

const routes = {
  "": instanceInfo,
  "v3": V3,
} satisfies { [path: string]: Route };

export default {
  async fetch(r: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(r.url).pathname.replace(/^\/bare\/?(.*)\/?$/, "$1");
    return routes[path](r);
  }
}

export interface Env {}
