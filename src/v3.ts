import type { Route } from "./types.ts";
import { HTTPStatus, baseResponse, error } from "./utils.ts";

const v3: Route = async (req) => {
  if(req.method === "OPTIONS") {
    return baseResponse(undefined, { status: HTTPStatus.OK });
  }

  const isSocket = req.headers.get("upgrade");
  if (isSocket) {
    return error(
      new Error("Unimplemented"),
      "UNKNOWN",
      "unknown",
      500
    );
  }

  const res = await fetch(
    req.headers.get("X-Bare-URL"),
    {
      method: req.method,
      headers: new Headers(JSON.parse(req.headers.get("X-Bare-Headers"))),
    }
  );

  return baseResponse( res.body , {
    headers: {
      "Content-Encoding": res.headers.get("Content-Encoding"),
      "Content-Length": res.headers.get("Content-Length"),
      "X-Bare-Headers": JSON.stringify(res.headers),
      "X-Bare-Status": res.status,
      "X-Bare-Status-Text": res.statusText,
    },
  });
};

export default v3;
