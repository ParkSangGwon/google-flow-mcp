# google-flow-mcp

Unofficial [MCP](https://modelcontextprotocol.io) server that drives **Google Flow** (labs.google, Veo / Nano Banana)
through your own Chrome session: video and image generation plus **Scene Builder** (add to scene, extend, jump to,
download).

> Work in progress: the first release (0.1.0) is being built. See `docs/tools.md` for the current tool surface.

- Node 20+, TypeScript, Playwright over CDP against a real Chrome (no bundled browser)
- Your Google login stays in a dedicated Chrome profile; no credentials are handled by this server
- Every generation tool has a 0-credit dry run (`auto_confirm: false`)

Korean: [README.ko.md](README.ko.md)
