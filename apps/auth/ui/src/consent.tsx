/**
 * /consent on the auth origin — the oauth-provider's default `consentPage`.
 * One shared ConsentPanel; the provider names the client and scopes.
 */
import { ConsentPanel } from '@aicolab/better-auth/solid/consent'
import { render } from '@solidjs/web'
import { Shell } from './shell.tsx'

function Page() {
	return (
		<Shell
			eyebrow="Optimal Care Pathways"
			title="Authorize access"
			lede="Review what the application is asking for, then approve or deny."
		>
			<ConsentPanel serviceName="Optimal Care Pathways" homeHref="/" />
		</Shell>
	)
}

const root = document.getElementById('app')
if (root) render(() => <Page />, root)
