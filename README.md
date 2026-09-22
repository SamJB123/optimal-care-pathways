# Optimal Care Pathways

A collaborative content management system for Cancer Australia's Optimal Care Pathways:
the documents, structured by cancer type or by population group, that set the national
standard for cancer care. Drafters, reviewers and viewers work per pathway; shared core
content is written once and rendered in every pathway; published versions are served to
partner sites through a read-only API.

Built as a self-contained set of Cloudflare Workers so it can be handed over and deployed
on any Cloudflare account.

## Layout

| Path | What it is |
|---|---|
| `apps/cms` | The application worker: Solid + TanStack Start, live editing rooms, the D1 content database, the published API. |
| `apps/auth` | The sign-in worker, built from `@aicolab/better-auth` with its own D1. |
| `packages/*` | Git submodules of the shared libraries (`better-auth`, `cloudflare`, `room-service`, `solid`, `ui`, `ui-solid`). |
| `tooling/*` | Shared TypeScript and Biome configuration. |
| `patches/` | pnpm patches the packages depend on. |

## Working on it

```
pnpm install
pnpm auth:db:migrate:local   # once, and after better-auth bumps
pnpm cms:dev                 # http://localhost:3100 (spawns the auth worker alongside)
pnpm check-types
pnpm test
```

Cloning: `git clone --recurse-submodules`. After a pull that moves a submodule pointer:
`git submodule update`.

Local sign-in uses email and password, enabled by `apps/auth/.dev.vars` (copy the example).
