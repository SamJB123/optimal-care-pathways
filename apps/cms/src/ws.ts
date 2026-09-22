/**
 * The app's one browser↔worker socket, from the kit. SINGLE-SPECIFIER RULE: import this
 * module as `#/ws.ts` ONLY — a second import path makes Vite instantiate it twice.
 */
import { createAppSocket } from '@aicolab/app-kit/ws'
import { authClient } from '#/lib/auth-client.ts'
import type { CoreRpcRoot } from '#/lib/rpc-root.ts'

export type { WsStatus } from '@aicolab/app-kit/ws'

export const { sharedSocket, startAuthDrivenSocket, wsFetch, getStatusSnapshot, subscribeStatus } =
	createAppSocket<CoreRpcRoot>({ authClient })
