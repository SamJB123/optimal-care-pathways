// Minimal worker entry for the workerd test pool (vitest.config.ts, via
// wrangler.test.jsonc → main). Exports the Durable Object classes the runtime
// must construct, plus a test-only auth stub so a room's real authenticated
// websocket upgrade path can be exercised without the auth worker.

// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
import { WorkerEntrypoint } from 'cloudflare:workers'
import { serveCapnweb } from '@aicolab/room-service/base-worker'
import { CoreRpcRoot, OcpBell } from '#/lib/rpc-root.ts'
import { DocumentRoom } from '#/rooms/document-room.ts'

export { DocumentRoom, OcpBell }

const issued = new Map<string, string>()
let tokenSequence = 0

/**
 * Membership without state: a test user id is `<role>@<orgId>` ('member@org-a' is a
 * drafter of org-a and of nothing else; 'nobody' belongs nowhere). Every membership
 * method reads the id, so a test never has to set anything up.
 */
const parseMember = (userId: string): { role: string; orgId: string } | null => {
	const at = userId.indexOf('@')
	return at > 0 ? { role: userId.slice(0, at), orgId: userId.slice(at + 1) } : null
}

export class TestAuth extends WorkerEntrypoint {
	/** The `/api/ws` upgrade's cookie check (serveCapnweb) and the root's `whoami`
	 *  probe: the cookie IS the user id in this fixture, so a browser socket dialled
	 *  with `Cookie: member@org-a` is sealed as `member@org-a`. */
	async verifySession(cookie: string) {
		return { user: cookie ? { id: cookie } : null }
	}

	async getUsersByIds(userIds: string[]) {
		return Object.fromEntries(userIds.map((id) => [id, { name: id }]))
	}

	async getOrgMembershipById(userId: string, orgId: string, _namespace: string) {
		const member = parseMember(userId)
		return member && member.orgId === orgId ? { organizationId: orgId, role: member.role } : null
	}

	async listUserOrgs(userId: string, _namespace?: string) {
		const member = parseMember(userId)
		return member
			? [
					{
						organizationId: member.orgId,
						role: member.role,
						slug: member.orgId,
						name: member.orgId,
					},
				]
			: []
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
	/** `/api/ws` is the REAL browser door (serveCapnweb over the app's own CoreRpcRoot),
	 *  so a pool test can run the production client stack — shared socket → managed
	 *  sessions → connectDocumentRoom → DocumentRoom — end to end. The Start handler is
	 *  stubbed: no server functions are served here. */
	async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
		if (new URL(request.url).pathname === '/api/ws') {
			return serveCapnweb({
				request,
				env,
				ctx,
				Root: CoreRpcRoot,
				handler: { fetch: () => new Response('not found', { status: 404 }) },
			})
		}
		return new Response('worker-runtime test entry')
	},
} satisfies ExportedHandler<Cloudflare.Env>
