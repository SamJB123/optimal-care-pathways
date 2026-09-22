/**
 * The inspector for the section in focus (decision 110): what it is, its review decision
 * strip when the document is under review and the caller may decide, its comment thread
 * with a composer, and — for shared content — the suggest-a-change and diverge actions
 * (decision 26). One panel serves editing and review mode alike.
 */

import {
	Button,
	Chip,
	Field,
	InspectorHeader,
	TextArea,
	ToolPanelActions,
	ToolPanelList,
	ToolPanelSection,
} from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show, useContext } from 'solid-js'
import { numberLabel } from '#/lib/labels.ts'
import { atLeast, DocumentContext } from '#/lifecycle/workspace.ts'
import {
	addComment,
	decideSection,
	divergeSection,
	resolveComment,
	revertSection,
} from '#/server/lifecycle-fns.ts'

const when = (ms: number) =>
	new Date(ms).toLocaleString('en-AU', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	})

export function SectionInspector() {
	const workspace = useContext(DocumentContext)
	const section = createMemo(
		() => workspace.sections().find((s) => s.id === workspace.focused()) ?? null,
	)
	const change = createMemo(
		() => workspace.state().changes.find((c) => c.sectionId === workspace.focused()) ?? null,
	)
	const thread = createMemo(() =>
		workspace.comments().filter((c) => c.sectionId === workspace.focused()),
	)
	const review = () => workspace.state().review
	const canDecide = () => {
		const r = review()
		return (
			r !== null && r.decision === null && r.superseded === 0 && atLeast(workspace.role, 'admin')
		)
	}
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	const run = async (action: () => Promise<unknown>) => {
		setBusy(true)
		setError(null)
		try {
			await action()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<Show when={section()}>
			{(s) => (
				<div class="ocp-inspector">
					<InspectorHeader
						eyebrow={<span class="ocp-inspector-eyebrow">{s().address}</span>}
						title={`${s().printedNumber ? `${numberLabel(s().printedNumber ?? '')} ` : ''}${s().title ?? s().address}`}
					>
						<Chip tone={s().ownership === 'shared' ? 'accent' : 'plain'}>
							{s().ownership === 'shared'
								? 'Shared from the core'
								: s().coreSectionId
									? 'Diverged from the core'
									: 'This document’s own'}
						</Chip>
						<Show when={change()}>
							{(c) => (
								<Chip tone="live">
									+{c().annotated.inserted} −{c().annotated.deleted} since published
								</Chip>
							)}
						</Show>
					</InspectorHeader>

					<Show when={error()}>
						{(text) => (
							<p class="ocp-inspector-error" role="alert">
								{text()}
							</p>
						)}
					</Show>

					<Show when={change() && review()}>
						<ToolPanelSection title="Review decision">
							<Show
								when={change()?.decision?.decision}
								fallback={<p class="ocp-muted">Awaiting a decision.</p>}
							>
								{(decision) => (
									<p>
										<Chip tone={decision() === 'approved' ? 'live' : 'accent'}>
											{decision() === 'approved' ? 'Approved' : 'Changes requested'}
										</Chip>
										<Show when={change()?.decision?.note}>
											{(note) => <span class="ocp-muted"> {note()}</span>}
										</Show>
									</p>
								)}
							</Show>
							<Show when={canDecide()}>
								<DecisionStrip
									busy={busy()}
									onDecide={(decision, note) =>
										run(async () => {
											const r = review()
											if (!r) return
											await decideSection({
												data: { reviewId: r.reviewId, sectionId: s().id, decision, note },
											})
											await workspace.refreshState()
										})
									}
								/>
							</Show>
						</ToolPanelSection>
					</Show>

					<ToolPanelSection
						title="Comments"
						meta={thread().length > 0 ? `${thread().length}` : undefined}
					>
						<ToolPanelList>
							<Show when={thread().length > 0} fallback={<p class="ocp-muted">No comments yet.</p>}>
								<For each={thread()}>
									{(comment) => (
										<article
											class="ocp-comment"
											data-resolved={comment.resolvedAt ? 'true' : undefined}
										>
											<header>
												<strong>{comment.authorName}</strong>
												<span class="ocp-muted"> {when(comment.createdAt)}</span>
												<Show when={comment.kind === 'suggestion'}>
													<Chip tone="accent">Suggestion</Chip>
												</Show>
											</header>
											<p>{comment.body}</p>
											<Show when={atLeast(workspace.role, 'member')}>
												<button
													type="button"
													class="ocp-comment-resolve"
													disabled={busy()}
													onClick={() =>
														run(async () => {
															await resolveComment({
																data: { commentId: comment.id, resolved: !comment.resolvedAt },
															})
															await workspace.refreshComments()
														})
													}
												>
													{comment.resolvedAt ? 'Reopen' : 'Resolve'}
												</button>
											</Show>
										</article>
									)}
								</For>
							</Show>
						</ToolPanelList>
						<Show when={atLeast(workspace.role, 'member')}>
							<Composer
								label="Add a comment"
								action="Comment"
								busy={busy()}
								onSubmit={(body) =>
									run(async () => {
										await addComment({
											data: {
												documentId: workspace.documentId,
												sectionId: s().id,
												kind: 'comment',
												body,
											},
										})
										await workspace.refreshComments()
									})
								}
							/>
						</Show>
					</ToolPanelSection>

					<Show when={s().ownership === 'shared' && atLeast(workspace.role, 'member')}>
						<ToolPanelSection title="Shared content">
							<p class="ocp-muted">
								This section is the core document’s. Suggest a change to the central team, or take
								your own copy to edit here.
							</p>
							<Composer
								label="Suggest a change"
								action="Send suggestion"
								busy={busy()}
								onSubmit={(body) =>
									run(async () => {
										await addComment({
											data: {
												documentId: workspace.documentId,
												sectionId: s().id,
												kind: 'suggestion',
												body,
											},
										})
										await workspace.refreshComments()
									})
								}
							/>
							<ToolPanelActions>
								<Button
									variant="outline"
									disabled={busy()}
									onClick={() =>
										run(async () => {
											if (
												!window.confirm(
													'Take your own copy of this section? Its shared text becomes this document’s draft, and stops following the core.',
												)
											)
												return
											await divergeSection({ data: { sectionId: s().id } })
											await workspace.refreshState()
										})
									}
								>
									Diverge from the core
								</Button>
							</ToolPanelActions>
						</ToolPanelSection>
					</Show>

					<Show
						when={
							s().ownership === 'owned' && s().coreSectionId && atLeast(workspace.role, 'member')
						}
					>
						<ToolPanelSection title="Diverged section">
							<p class="ocp-muted">This document keeps its own copy of a shared section.</p>
							<ToolPanelActions>
								<Button
									variant="outline"
									disabled={busy()}
									onClick={() =>
										run(async () => {
											if (
												!window.confirm(
													'Return to the shared version? This document’s own text for the section is discarded.',
												)
											)
												return
											await revertSection({ data: { sectionId: s().id } })
											await workspace.refreshState()
										})
									}
								>
									Revert to the shared version
								</Button>
							</ToolPanelActions>
						</ToolPanelSection>
					</Show>
				</div>
			)}
		</Show>
	)
}

function DecisionStrip(props: {
	busy: boolean
	onDecide: (decision: 'approved' | 'changes_requested', note: string | null) => void
}) {
	let note!: HTMLTextAreaElement
	return (
		<div class="ocp-decision">
			<Field label="Note for the drafter (optional)">
				<TextArea ref={note} rows={2} />
			</Field>
			<ToolPanelActions>
				<Button
					variant="solid"
					colorBase="success"
					disabled={props.busy}
					onClick={() => props.onDecide('approved', note.value.trim() || null)}
				>
					Approve
				</Button>
				<Button
					variant="outline"
					colorBase="warning"
					disabled={props.busy}
					onClick={() => props.onDecide('changes_requested', note.value.trim() || null)}
				>
					Request changes
				</Button>
			</ToolPanelActions>
		</div>
	)
}

function Composer(props: {
	label: string
	action: string
	busy: boolean
	onSubmit: (body: string) => void
}) {
	let body!: HTMLTextAreaElement
	return (
		<form
			class="ocp-composer"
			onSubmit={(event) => {
				event.preventDefault()
				const text = body.value.trim()
				if (!text) return
				props.onSubmit(text)
				body.value = ''
			}}
		>
			<Field label={props.label}>
				<TextArea ref={body} rows={3} />
			</Field>
			<ToolPanelActions>
				<Button type="submit" variant="solid" disabled={props.busy}>
					{props.action}
				</Button>
			</ToolPanelActions>
		</form>
	)
}
