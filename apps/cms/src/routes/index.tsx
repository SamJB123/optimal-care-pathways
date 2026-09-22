/**
 * Home: the signed-in user's documents (live), a central member's tools (create a
 * pathway), and the first-run bootstrap of the central organisation.
 */

import { SignInGate } from '@aicolab/app-kit/solid/sign-in-gate'
import { Button, ButtonLink, Notice, PageHero, Panel, Section, TextInput } from '@aicolab/ui-solid'
import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { useAuthSession } from '#/lib/auth-client.ts'
import { bootstrapCentral, createPathway, documentsSnapshot } from '#/server/documents.ts'
import './index.css'

export const Route = createFileRoute('/')({
	loader: async () => {
		try {
			return { snapshot: await documentsSnapshot() }
		} catch {
			return { snapshot: null }
		}
	},
	component: Home,
})

function Home() {
	const session = useAuthSession()
	const data = Route.useLoaderData()
	return (
		<div class="ocp-home">
			<PageHero
				eyebrow="Cancer Australia"
				title="Optimal Care Pathways"
				lede="Draft, review and publish the national standards for cancer care, one pathway at a time."
			/>
			<Show
				when={session().user}
				fallback={
					<SignInGate
						title="Sign in to your pathways"
						description="A one-time code is sent to your email address."
						callbackPath="/"
					/>
				}
			>
				<Documents snapshot={data().snapshot} />
			</Show>
		</div>
	)
}

function Documents(props: { snapshot: Awaited<ReturnType<typeof documentsSnapshot>> | null }) {
	const navigate = useNavigate()
	const [message, setMessage] = createSignal<string | null>(null)
	const [busy, setBusy] = createSignal(false)
	const documents = () => props.snapshot?.documents ?? []
	const pathways = () => documents().filter((d) => d.kind === 'pathway')
	const core = () => documents().filter((d) => d.kind === 'core')

	const bootstrap = async () => {
		setBusy(true)
		try {
			const result = await bootstrapCentral()
			setMessage(
				`Central organisation ready; ${result.adoptedCoreDocuments} core documents adopted. Reloading…`,
			)
			window.location.reload()
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	let title!: HTMLInputElement
	let subject!: HTMLInputElement
	let slug!: HTMLInputElement
	let kind!: HTMLSelectElement
	const create = async (event: Event) => {
		event.preventDefault()
		setBusy(true)
		try {
			const result = await createPathway({
				data: {
					kind: kind.value === 'population' ? 'population' : 'cancer',
					title: title.value,
					subject: subject.value,
					slug: slug.value,
				},
			})
			await navigate({ to: '/d/$documentId', params: { documentId: result.documentId } })
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	return (
		<Section center>
			<Show when={message()}>
				{(text) => (
					<Notice colorBase="info" variant="soft">
						{text()}
					</Notice>
				)}
			</Show>
			<Show
				when={documents().length > 0}
				fallback={
					<Panel title="Nothing here yet" variant="soft">
						<p>
							You are not a member of any pathway. If you are an administrator of this deployment,
							set up the central organisation first.
						</p>
						<Button variant="solid" disabled={busy()} onClick={() => void bootstrap()}>
							Set up the central organisation
						</Button>
					</Panel>
				}
			>
				<Show when={pathways().length > 0}>
					<Panel title="Pathways" variant="soft">
						<ul class="ocp-document-list">
							<For each={pathways()}>
								{(doc) => (
									<li>
										<ButtonLink href={`/d/${doc.id}`} variant="text">
											{doc.title}
										</ButtonLink>
										<span class="ocp-document-meta">
											{doc.status}
											{doc.publishedVersionNo > 0 ? ` · v${doc.publishedVersionNo}` : ''}
										</span>
									</li>
								)}
							</For>
						</ul>
					</Panel>
				</Show>
				<Show when={props.snapshot?.central}>
					<Panel title="Core content" variant="soft">
						<ul class="ocp-document-list">
							<For each={core()}>
								{(doc) => (
									<li>
										<ButtonLink href={`/d/${doc.id}`} variant="text">
											{doc.title}
										</ButtonLink>
										<span class="ocp-document-meta">{doc.audience}</span>
									</li>
								)}
							</For>
						</ul>
					</Panel>
					<Panel title="Start a pathway" variant="soft">
						<form class="ocp-create-form" onSubmit={(e) => void create(e)}>
							<label>
								Kind
								<select ref={kind}>
									<option value="cancer">Cancer type</option>
									<option value="population">Population group</option>
								</select>
							</label>
							<TextInput
								ref={title}
								placeholder="Optimal Care Pathway for people with breast cancer"
								aria-label="Title"
								required
							/>
							<TextInput
								ref={subject}
								placeholder="breast cancer"
								aria-label="Subject (replaces [cancer type])"
								required
							/>
							<TextInput
								ref={slug}
								placeholder="breast-cancer"
								aria-label="Slug"
								pattern="[a-z0-9]+(-[a-z0-9]+)*"
								required
							/>
							<Button type="submit" variant="solid" disabled={busy()}>
								Create
							</Button>
						</form>
					</Panel>
				</Show>
			</Show>
		</Section>
	)
}
