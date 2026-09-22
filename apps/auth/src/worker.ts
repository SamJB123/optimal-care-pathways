/**
 * Portal's auth worker entry — a thin re-export of the canonical
 * `@aicolab/better-auth` D1 AuthService. This file exists so portal has
 * a dedicated deployment target for the auth service (its own
 * wrangler.jsonc, its own bindings, its own dev/deploy scripts) without
 * forking the package source.
 *
 * Portal uses the D1 path; the PG path lives at
 * `@aicolab/better-auth/cloudflare/pg/worker` for deployments that bind
 * Hyperdrive instead. Switching dialects is a one-line import change here
 * — every type flows from this re-export.
 *
 * If portal ever needs to customise auth behaviour — add an RPC method,
 * subclass AuthService, swap a plugin — that change lands here. Until
 * then this stays a one-liner.
 */

export { AuthService, default } from '@aicolab/better-auth/cloudflare/d1/worker'
