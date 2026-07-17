# Contributing to ispection-agent

Thanks for helping improve the agent! It's MIT-licensed and contributions are welcome.

## Ground rule: zero runtime dependencies

The agent is intentionally **standalone** — it uses only Node.js built-ins and ships with **no runtime
`dependencies`** (see `package.json`). This keeps it tiny and safe to run on NAS boxes and unusual
architectures.

- **Do not add runtime dependencies.** If a change seems to need one, open an issue first to discuss.
- Dev-only tooling (`devDependencies`: TypeScript, `ts-node`, `@types/node`) is fine.

## Development

Requires **Node 22+** (global `fetch`/`WebSocket`).

```bash
npm ci
npm run build      # tsc → dist/
npm run typecheck  # type-check only
npm run dev        # run from source (ts-node)
```

Run it against a local collector:

```bash
INGEST_URL=http://localhost:3000/api INGEST_INSECURE=true CLAIM_CODE=<code> npm run dev
```

`INGEST_INSECURE=true` is **dev-only** (HTTP, skips cert pinning). See the [README](README.md) for all env vars.

## Style & conventions

- **TypeScript, English** for code and comments. Keep comments to the ones that matter (the *why*, not the *what*).
- Match the surrounding code; keep each change focused.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `chore:`, `docs:` …).
- Keep CI green (`npm run typecheck` / `npm run build`).

## Pull requests

1. Fork and branch from `master`.
2. Make a small, focused change; update the README if behaviour or env vars change.
3. Ensure `npm run build` passes.
4. Open the PR, fill in the template, and link any related issue.

## Security

Please **do not** open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## Releases (maintainers)

Bump `version` in `package.json`, then push a matching tag:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

The `release` workflow builds and publishes a cosign-signed image to `ghcr.io/robimy-online/ispection-agent`.
The tag **must** equal the `package.json` version (CI asserts this).
