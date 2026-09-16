# Infrared

Alternatives to bare-server and Ultraviolet

`/` -> Web UI

`/bare/*` -> Bare Server V3

`/wisp/` -> Wisp Proxy (TCP; UDP streams are rejected because Workers exposes outbound TCP sockets only)

`/test.html` -> Bare / Wisp test console

The root page provides URL normalization, Service Worker based request forwarding, full-screen proxied response previews, local history, bookmarks, theme settings, and Bare/Wisp selection.

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
