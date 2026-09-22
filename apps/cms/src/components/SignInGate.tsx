/** Sign-in gate composition. Mechanics and controls live in @aicolab/better-auth. */
import { SignInPanel } from '@aicolab/better-auth/solid/sign-in'
import { PageHero, Section } from '@aicolab/ui-solid'
import './SignInGate.css'

export function SignInGate(props: { title: string; description: string; callbackPath: string }) {
	return (
		<Section class="ocp-signin" center>
			<PageHero eyebrow="Sign in required" title={props.title} lede={props.description} />
			<SignInPanel
				class="ocp-signin-panel"
				callbackURL={`${window.location.origin}${props.callbackPath}`}
				errorCallbackURL={`${window.location.origin}${window.location.pathname}`}
			/>
		</Section>
	)
}
