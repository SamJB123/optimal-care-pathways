/**
 * /library — the public library of published pathways (decision S1), for readers who are
 * signed in too: the same page a visitor lands on at /.
 */

import { createFileRoute } from '@tanstack/solid-router'
import { Library } from '#/components/Library.tsx'
import { Masthead } from '#/components/Masthead.tsx'
import { publicLibrary } from '#/server/atlas.ts'

export const Route = createFileRoute('/library')({
	loader: async () => ({ library: await publicLibrary() }),
	component: LibraryPage,
})

function LibraryPage() {
	const data = Route.useLoaderData()
	return (
		<>
			<Masthead crumbs={[{ label: 'Published library' }]} />
			<main>
				<Library entries={data().library} />
			</main>
		</>
	)
}
