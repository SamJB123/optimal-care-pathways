/**
 * /admin — the deployment's administration (decision S11): the doors a fresh or re-seeded
 * deployment needs (set up the central organisation; finalise the legacy imports), the
 * register of every document's family colour, the central team, and the core templates.
 * Each door says in one sentence what is waiting and reports what it did in place.
 */

import { Button } from '@aicolab/ui-solid'
import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { Masthead } from '#/components/Masthead.tsx'
import { adminSnapshot } from '#/server/admin.ts'
import { bootstrapCentral } from '#/server/documents.ts'
import { finaliseLegacyImports } from '#/server/legacy-fns.ts'
import './admin.css'

export const Route = createFileRoute('/admin')({
	loader: async () => ({ admin: await adminSnapshot() }),
	component: AdminPage,
})

function AdminPage() {
	const data = Route.useLoaderData()
	const router = useRouter()
	const [busy, setBusy] = createSignal(false)
	const [report, setReport] = createSignal<{ tone: 'done' | 'error'; text: string } | null>(null)

	const run = async (door: () => Promise<string>) => {
		setBusy(true)
		setReport(null)
		try {
			setReport({ tone: 'done', text: await door() })
			await router.invalidate()
		} catch (error) {
			setReport({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
		} finally {
			setBusy(false)
		}
	}

	const setUp = () =>
		run(async () => {
			const result = await bootstrapCentral()
			return `The central organisation is set up and owns ${result.adoptedCoreDocuments} core documents.`
		})

	const finalise = () =>
		run(async () => {
			const result = await finaliseLegacyImports()
			const made = `${result.finalised.length} organisation${result.finalised.length === 1 ? '' : 's'} created, ${result.rendered} published sections rendered.`
			if (result.errors.length > 0) throw new Error(`${made} Not finalised: ${result.errors.join('; ')}.`)
			return made
		})

	return (
		<>
			<Masthead crumbs={[{ label: 'Pathways', href: '/' }, { label: 'Administration' }]} central={data().admin.central} />
			<main class="ocp-admin">
				<h1>Administration</h1>
				<Show when={report()}>
					{(r) => (
						<p class="ocp-admin-report" data-tone={r().tone} role={r().tone === 'error' ? 'alert' : 'status'}>
							{r().text}
						</p>
					)}
				</Show>

				<section class="ocp-admin-section" aria-labelledby="ocp-admin-deployment">
					<h2 id="ocp-admin-deployment">This deployment</h2>
					<Show
						when={data().admin.setUp || data().admin.pending.length > 0}
						fallback={<p class="ocp-muted">Nothing is waiting: the central organisation owns the core templates and every import is finalised.</p>}
					>
						<Show when={data().admin.setUp}>
							<div class="ocp-admin-door">
								<p>
									The core templates have no owner yet. Setting up creates (or finds) the central organisation, makes you
									a member, and hands it the core templates. Only an administrator listed for this deployment can do this.
								</p>
								<Button variant="solid" disabled={busy()} onClick={() => void setUp()}>
									Set up the central organisation
								</Button>
							</div>
						</Show>
						<Show when={data().admin.pending.length > 0}>
							<div class="ocp-admin-door">
								<p>
									{data().admin.pending.length} imported {data().admin.pending.length === 1 ? 'pathway has' : 'pathways have'} a
									published edition and a draft but no organisation. Finalising creates each organisation with you as its
									lead and renders the published edition for the public pages.
								</p>
								<ul class="ocp-admin-pending">
									<For each={data().admin.pending}>{(p) => <li>{p.name}</li>}</For>
								</ul>
								<Button variant="solid" disabled={busy()} onClick={() => void finalise()}>
									Finalise legacy imports
								</Button>
							</div>
						</Show>
					</Show>
				</section>
			</main>
		</>
	)
}
