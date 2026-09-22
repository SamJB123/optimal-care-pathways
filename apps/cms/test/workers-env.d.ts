/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Types the `cloudflare:test` ambient `env` with this worker's generated bindings
// (worker-configuration.d.ts, from `pnpm cf-typegen`).
// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
declare module 'cloudflare:test' {
	interface ProvidedEnv extends Cloudflare.Env {}
}
