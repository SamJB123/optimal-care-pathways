// Minimal worker entry for the workerd test pool (vitest.config.ts, via
// wrangler.test.jsonc → main). Exports the Durable Object classes the runtime
// must construct, plus a test-only auth stub so a room's real authenticated
// websocket upgrade path can be exercised without the auth worker.
// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
import { WorkerEntrypoint } from 'cloudflare:workers'

const issued = new Map<string, string>()
let tokenSequence = 0

export class TestAuth extends WorkerEntrypoint {
	async getUsersByIds(userIds: string[]) {
		return Object.fromEntries(userIds.map((id) => [id, { name: id }]))
	}

	async generateOneTimeToken(userId: string): Promise<string> {
		const token = `ocp-test:${++tokenSequence}`
		issued.set(token, userId)
		return token
	}

	async verifyOneTimeToken(token: string) {
		const userId = issued.get(token)
		issued.delete(token)
		return userId ? { user: { id: userId } } : { user: null }
	}
}

export default {
	async fetch(): Promise<Response> {
		return new Response('worker-runtime test entry')
	},
} satisfies ExportedHandler<Cloudflare.Env>
