# Security and privacy

- The server never asks for, reads or stores Google credentials. You sign in once in the dedicated Chrome window;
  the session lives in the Chrome profile directory (`~/.google-flow-chrome` by default). Treat that directory like a
  password: do not share it, back it up unencrypted, or run the server on a machine other people can log into.
- Chrome is started with `--remote-debugging-port` bound to `127.0.0.1`. Anything on your machine that can reach that
  port can drive the browser; do not expose it.
- Downloads are fetched through the browser's own authenticated session and written to the `output_dir` you pass.
  Logs and screenshots go to `~/.google-flow-mcp`; screenshots may contain your prompts and generated media.
- Prompts are sent to Google Flow exactly as you pass them.

To report a vulnerability, open a GitHub issue with the label `security` or contact the maintainer through the
GitHub profile; please do not include exploit details in a public issue before a fix is available.
