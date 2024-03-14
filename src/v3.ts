import type { Route } from "./types.ts";
import { HTTPStatus, baseResponse, error } from "./utils.ts";

const v3: Route = async (r) => {
  if(r.method === "OPTIONS") {
    return baseResponse(undefined, { status: HTTPStatus.OK });
  }

  const isSocket = r.headers.get("upgrade");
  if (isSocket) {
    return error(
      new Error("Unimplemented"),
      "UNKNOWN",
      "unknown",
      500
    );
  }
};

export default v3;
