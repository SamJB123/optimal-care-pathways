/**
 * HTML the platform ships ahead of Solid's JSX types: `interestfor` (an interest invoker,
 * the declarative hover/focus/long-press opener for a popover — Chrome 142+), set on
 * links and buttons that open a hover card.
 */

import 'solid-js'

declare module '@solidjs/web/jsx-runtime' {
	namespace JSX {
		interface HTMLAttributes<T> {
			interestfor?: string
		}
	}
}
