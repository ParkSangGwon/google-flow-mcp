# Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
- `npm run check` must pass; it runs formatting, lint (typescript-eslint strict), type checking, unit and stdio
  contract tests and verifies that `docs/tools.md` is regenerated.
- Live tests against Google Flow are not run in CI and must never be required for a PR. If you changed a selector,
  say which Flow UI language and date you verified it on and paste the relevant `flow_inspect` rows in the PR.
- New UI strings go into `src/flow/labels.ts` with both Korean and English forms (add another language as a third
  alternative, do not replace).
- Keep tools thin: zod schemas in `src/tools/*.ts`, browser logic in `src/flow/*.ts`, nothing Flow-specific in
  `src/browser/*`.
- No `console.log` (stdout is the MCP transport); use the logger.
