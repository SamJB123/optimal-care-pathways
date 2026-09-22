/**
 * /sign-in on the auth origin — the oauth-provider's `loginPage`.
 *
 * The provider redirects here with its signed query when an OAuth client
 * starts an authorization and the browser has no session. The shared
 * SignInPanel does the rest: the auth client's oauthProviderClient plugin
 * attaches the signed query to the OTP or Google sign-in request, and the
 * provider resumes the authorization the moment the session is created
 * (its after-hook runs authorize and returns the redirect). Visiting this
 * page without a pending authorization just signs you in.
 */
import { SignInPanel } from '@aicolab/better-auth/solid/sign-in'
import { render } from '@solidjs/web'
import { createSignal, onSettled, Show } from 'solid-js'
import { Shell } from './shell.tsx'

function Page() {
	const [pending, setPending] = createSignal(false)
	onSettled(() => {
		setPending(new URLSearchParams(window.location.search).has('sig'))
	})
	return (
		<Shell
			eyebrow="Optimal Care Pathways"
			title="Sign in"
			lede={
				pending()
					? 'An application is asking to connect to your Optimal Care Pathways account. Sign in to continue; you will be asked to approve the connection next.'
					: 'Sign in to your Optimal Care Pathways account.'
			}
		>
			{/* Google lands back on this page (with the signed query still in the
			    URL, so the provider can resume); OTP resumes in place. */}
			<SignInPanel callbackURL={window.location.href} errorCallbackURL={window.location.href} />
			<Show when={!pending()}>
				<p class="au-lede" style={{ 'font-size': '0.85rem', 'margin-block-start': '1rem' }}>
					Signed in? You can close this page.
				</p>
			</Show>
		</Shell>
	)
}

const root = document.getElementById('app')
if (root) render(() => <Page />, root)
