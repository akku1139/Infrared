import type { Route } from "./types.ts";
import { JSONResponse } from "./utils.ts";

import * as pkg from "../package.json";

const instanceInfo: Route = async (r) => {
  return JSONResponse({
    versions: [
      "v3",
    ],
    language: "ServiceWorker",
    project: {
      name: "infrared",
      description: "Infrared Bare Server",
      repository: pkg.repository.url,
      version: pkg.version,
    },
  });
};

export default instanceInfo;
