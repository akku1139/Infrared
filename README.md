# Infrared

Alternatives to bare-server and Ultraviolet

`/` -> Web UI

`/bare/*` -> Bare Server V3

`/wisp/` -> Wisp Proxy (TCP; UDP streams are rejected because Workers exposes outbound TCP sockets only)

`/service/<encoded-url>` -> Ultraviolet-compatible proxied navigation

`/test.html` -> Bare / Wisp test console

The root page uses the official Ultraviolet runtime for HTML, CSS, JavaScript, fetch/XHR, WebSocket, EventSource, History, cookie, and navigation rewriting. Bare V3 and Wisp are selectable transports through Bare-Mux; the runtime assets and license notices are available under `/uv/`, `/baremux/`, `/epoxy/`, and `/credits.html`. The page also provides full-screen proxied response previews, local history, bookmarks, and theme settings.

## Build

Build settings

| Setting Name | Data |
| --- | ---|
| Build command | `bun run build` |
| Build output directory | / `public` |

Environment variables

| Name | Data |
| --- | --- |
| BUN_VERSION | `1.0.30` |
| NODE_ENV | `production` |
