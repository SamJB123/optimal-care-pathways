/** / on the auth origin — who you are signed in as, and sign in/out. */
import { createUseAuthSession } from '@aicolab/better-auth/solid'
import { AccountMenu } from '@aicolab/better-auth/solid/account-menu'
import { render } from '@solidjs/web'
import { Shell } from './shell.tsx'

// No SSR seed on these static pages: the live session atom is the source.
const useAuthSession = createUseAuthSession(() => null)

function Page() {
	const session = useAuthSession()
	return (
		<Shell
			eyebrow="Optimal Care Pathways"
			title="Your account"
			lede="The sign-in service for the Optimal Care Pathways content system. The application connects here to confirm who you are."
		>
			<AccountMenu session={session} />
		</Shell>
	)
}

const root = document.getElementById('app')
if (root) render(() => <Page />, root)
