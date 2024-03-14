export const baseResponse = (body?: BodyInit, init?: ResponseInit): Response => {
  const r = new Response(body, init);

  // https://github.com/tomphttp/bare-server-worker/blob/master/src/BareServer.ts#L183
  r.headers.set("x-robots-tag", "noindex");
  r.headers.set("access-control-allow-headers", "*");
  r.headers.set("access-control-allow-origin", "*");
  r.headers.set("access-control-allow-methods", "*");
  r.headers.set("access-control-expose-headers", "*");
  // don"t fetch preflight on every request...
  // instead, fetch preflight every 10 minutes
  r.headers.set("access-control-max-age", "7200");

  return r;
};

export const json = (j: Object, status: number | HTTPStatus): Response => {
  return baseResponse(
    JSON.stringify(j),
    {
      status: status,
      headers: {
        "Content-Type": "application/json",
      }
    }
  );
};

export const error = (e: Error, code: string, id: string, status: number | HTTPStatus = HTTPStatus.InternalServerError): Response => {
  return json({
    code: code,
    id: id,
    message: e.message,
    stack: e.stack,
  }, status);
}

export enum HTTPStatus {
  SwitchingProtocols = 101,
  Processing = 102,
  EarlyHints = 103,
  OK = 200,
  Created = 201,
  Accepted = 202,
  NonAuthoritativeInformation = 203,
  NoContent = 204,
  ResetContent = 205,
  PartialContent = 206,
  MultiStatus = 207,
  AlreadyReported = 208,
  IMUsed = 226,
  MultipleChoices = 300,
  MovedPermanently = 301,
  Found = 302,
  SeeOther = 303,
  NotModified = 304,
  TemporaryRedirect = 307,
  PermanentRedirect = 308,
  BadRequest = 400,
  Unauthorized = 401,
  PaymentRequired = 402,
  Forbidden = 403,
  NotFound = 404,
  MethodNotAllowed = 405,
  NotAcceptable = 406,
  ProxyAuthenticationRequired = 407,
  RequestTimeout = 408,
  Conflict = 409,
  Gone = 410,
  LengthRequired = 411,
  PreconditionFailed = 412,
  ContentTooLarge = 413,
  URITooLong = 414,
  UnsupportedMediaType = 415,
  RangeNotSatisfiable = 416,
  ExpectationFailed = 417,
  ImaTeaPot = 418,
  MisdirectedRequest = 421,
  UnprocessableContent = 422,
  Locked = 423,
  FailedDependency = 424,
  TooEarly = 425,
  UpgradeRequired = 426,
  PreconditionRequired = 428,
  TooManyRequests = 429,
  RequestHeaderFields = 431,
  UnavailableForLegal = 451,
  InternalServerError = 500,
  NotImplemented = 501,
  BadGateway = 502,
  ServiceUnavailable = 503,
  GatewayTimeout = 504,
  HTTPVersionNot = 505,
  VariantAlsoNegotiates = 506,
  InsufficientStorage = 507,
  LoopDetected = 508,
  NotExtended = 510,
  NetworkAuthenticationRequired = 511,
}
