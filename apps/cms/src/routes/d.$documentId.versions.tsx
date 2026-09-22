/**
 * The document's versions (decision 115): the draft, the published one and the archived
 * ones, newest first, with their labels and release notes.
 */

import { Chip, EmptyState, Panel } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { versionsOf } from '#/server/lifecycle-fns.ts'

export const Route = createFileRoute('/d/$documentId/versions')({
	loader: async ({ params }) => versionsOf({ data: { documentId: params.documentId } }),
	component: VersionsPage,
})

const when = (ms: number) =>
	new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

function VersionsPage() {
	const versions = Route.useLoaderData()
	return (
		<div class="ocp-part">
			<Panel title="Versions" variant="soft">
				<Show
					when={versions().length > 0}
					fallback={<EmptyState title="No versions yet" pad="1.25rem" />}
				>
					<ol class="ocp-versions">
						<For each={versions()}>
							{(version) => (
								<li class="ocp-version" data-status={version.status}>
									<div class="ocp-version-head">
										<strong>Version {version.versionNo}</strong>
										<Chip
											tone={
												version.status === 'published'
													? 'live'
													: version.status === 'draft'
														? 'accent'
														: 'plain'
											}
										>
											{version.status === 'published'
												? 'Published'
												: version.status === 'draft'
													? 'Draft'
													: 'Archived'}
										</Chip>
										<Show when={version.label}>{(label) => <span>{label()}</span>}</Show>
									</div>
									<div class="ocp-muted">
										{version.publishedAt
											? `Published ${when(version.publishedAt)}`
											: `Opened ${when(version.createdAt)}`}
									</div>
									<Show when={version.releaseNotes}>{(notes) => <p>{notes()}</p>}</Show>
								</li>
							)}
						</For>
					</ol>
				</Show>
			</Panel>
		</div>
	)
}
