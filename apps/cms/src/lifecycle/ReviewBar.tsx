/**
 * Review mode's bar (decisions S14, 108, 112), in the editing toolbar's place at the top of
 * the text column: where the review stands, what the text shows (the changed sections
 * only, or everything with the changes marked; the changes marked, or the text as it
 * will publish), the way through the changes (J and K), and the way back to writing.
 * One switch for the page: every section flips together.
 */

import { Button, IconButton, Segmented } from '@aicolab/ui-solid'
import { useContext } from 'solid-js'
import { DocumentContext, needsAttention } from './workspace.ts'
import './review.css'

export function ReviewBar() {
	const workspace = useContext(DocumentContext)
	const review = () => workspace.state().review
	const waiting = () => workspace.changeOrder().filter((e) => needsAttention(e, review())).length
	const standing = (): string => {
		const r = review()
		const n = workspace.state().changes.length
		if (!r)
			return workspace.state().published
				? `${n} change${n === 1 ? '' : 's'} since the published edition`
				: `${n} section${n === 1 ? '' : 's'} in the first edition`
		if (r.decision === 'approved') return 'The review is approved in full'
		if (r.decision === 'changes_requested') return `Changes asked for on ${r.changesRequested} of ${r.total}`
		return `${r.decided} of ${r.total} decided`
	}
	const stepLabel = () => {
		const r = review()
		return r && r.decision === null ? 'undecided' : r?.decision === 'changes_requested' ? 'sent back' : 'change'
	}

	return (
		<div class="ocp-review-bar" role="toolbar" aria-label="Reading the changes">
			<p class="ocp-review-standing" aria-live="polite">
				{standing()}
			</p>
			<span class="ocp-review-switches">
				<Segmented
					label="Show"
					class="ocp-review-switch"
					options={[
						{ id: 'changed', label: 'Changed only' },
						{ id: 'everything', label: 'Everything' },
					]}
					value={workspace.reviewScope()}
					onChange={(scope) => workspace.setReviewScope(scope)}
				/>
				<Segmented
					label="Changes"
					class="ocp-review-switch"
					options={[
						{ id: 'marks', label: 'Marked' },
						{ id: 'clean', label: 'As it will publish' },
					]}
					value={workspace.diffView()}
					onChange={(view) => workspace.setDiffView(view)}
				/>
			</span>
			<span class="ocp-review-steps">
				<IconButton
					label={`Previous ${stepLabel()}`}
					title={`Previous ${stepLabel()} (K)`}
					disabled={waiting() === 0}
					onClick={() => workspace.goToChange(-1)}
				>
					<span aria-hidden="true">↑</span>
				</IconButton>
				<Button variant="outline" disabled={waiting() === 0} title={`Next ${stepLabel()} (J)`} onClick={() => workspace.goToChange(1)}>
					Next {stepLabel()} <span class="ocp-review-key">J</span>
				</Button>
				<IconButton label="Back to the text" title="Back to the text" onClick={() => workspace.setMode('edit')}>
					<span aria-hidden="true">✕</span>
				</IconButton>
			</span>
		</div>
	)
}
