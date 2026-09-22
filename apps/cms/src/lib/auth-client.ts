/**
 * App binding of the shared Solid better-auth client. `useAuthSession` seeds
 * itself from the root route's SSR-loaded session; the raw `authClient` atom also
 * drives module-scope consumers such as the capnweb socket (ws.ts).
 */
import { createUseAuthSession } from '@aicolab/better-auth/solid'
import { getRouteApi } from '@tanstack/solid-router'

export { type AuthSessionView, authClient } from '@aicolab/better-auth/solid'

const rootRoute = getRouteApi('__root__')

export const useAuthSession = createUseAuthSession(() => rootRoute.useLoaderData()()?.authSession)
