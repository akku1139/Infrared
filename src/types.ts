export interface Env {}

export type Route = (r: Request, env?: Env) => Promise<Response> | Response;

// WebSocket message types for Bare Server V3
export interface SocketClientToServer {
  type: "connect";
  remote: string;
  protocols: string[];
  headers: Record<string, string | string[]>;
  forwardHeaders: string[];
}

export interface SocketServerToClient {
  type: "open";
  protocol: string;
  setCookies: string[];
}

export interface BareHeaders {
  [header: string]: string | string[];
}
