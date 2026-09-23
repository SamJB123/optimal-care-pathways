/**
 * /admin — the deployment's administration (decision S11): the doors a fresh or re-seeded
 * deployment needs (set up the central organisation; finalise the legacy imports), the
 * register of every document's family colour, the central team, and the core templates.
 * Each door says in one sentence what is waiting and reports what it did in place.
 */

import { Button } from '@aicolab/ui-solid'
import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { AccentEditor } from '#/components/AccentEditor.tsx'
import { Masthead } from '#/components/Masthead.tsx'
import { familyStyle } from '#/lib/family.ts'
import { fidelityHref, publishedHref, workspaceHref } from '#/lib/links.ts'
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

	const cores = createMemo(() => data().admin.documents.filter((doc) => doc.kind === 'core'))
	/** The register, as the atlas groups it: the core templates, then each kind of pathway. */
	const colourGroups = createMemo(() => {
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
		const docs = data().admin.documents
		return [
			{ label: 'Core templates', documents: docs.filter((doc) => doc.kind === 'core').toSorted(byName) },
			{ label: 'Cancer-specific pathways', documents: docs.filter((doc) => doc.kind === 'pathway' && doc.audience === 'cancer').toSorted(byName) },
			{ label: 'Population pathways', documents: docs.filter((doc) => doc.kind === 'pathway' && doc.audience === 'population').toSorted(byName) },
		].filter((group) => group.documents.length > 0)
	})

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

				<Show when={data().admin.central}>
					<section class="ocp-admin-section" aria-labelledby="ocp-admin-cores">
						<h2 id="ocp-admin-cores">The core templates</h2>
						<ul class="ocp-admin-cores">
							<For each={cores()}>
								{(core) => (
									<li style={familyStyle(core.accent)}>
										<a class="ocp-admin-core-name" href={workspaceHref(core.id)}>
											{core.name}
										</a>
										<span class="ocp-admin-core-links">
											<Show when={core.published} fallback={<span class="ocp-muted">Not yet published</span>}>
												<a href={publishedHref(core.slug)}>The published page</a>
											</Show>
											<a href={`${workspaceHref(core.id)}/suggestions`}>Suggestions from pathways</a>
											<a href={fidelityHref(core.id)}>Against the template PDF</a>
										</span>
									</li>
								)}
							</For>
						</ul>
					</section>

					<section class="ocp-admin-section" aria-labelledby="ocp-admin-colours">
						<h2 id="ocp-admin-colours">Family colours</h2>
						<p class="ocp-muted">
							Each document’s colour, read from its print: the atlas row, the spine, the published page’s steps and links. A
							colour is set at the lightness its text needs on each ground; the fill keeps the print’s own.
						</p>
						<For each={colourGroups()}>
							{(group) => (
								<div class="ocp-admin-colour-group">
									<h3>{group.label}</h3>
									<ul class="ocp-admin-colours">
										<For each={group.documents}>
											{(doc) => (
												<li>
													<a class="ocp-admin-colour-name" href={workspaceHref(doc.id)} style={familyStyle(doc.accent)}>
														{doc.name}
													</a>
													<AccentEditor
														documentId={doc.id}
														name={doc.name}
														accent={doc.accent}
														printAccent={doc.printAccent}
														onSaved={() => router.invalidate()}
													/>
												</li>
											)}
										</For>
									</ul>
								</div>
							)}
						</For>
					</section>
				</Show>
			</main>
		</>
	)
}
