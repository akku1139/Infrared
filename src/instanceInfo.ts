import type { Route } from "./types";
import { json, HTTPStatus } from "./utils";

import * as pkg from "../package.json";

const instanceInfo: Route = async (r) => {
  return json({
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
  }, HTTPStatus.OK);
};

export default instanceInfo;
