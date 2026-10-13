/**
 * The preload script, which deliberately does nothing.
 *
 * It exists so `contextIsolation: true` has a real file behind it. With no preload, Electron renders
 * a window with no isolated world at all and the security posture depends on defaults nobody chose;
 * with an empty one, "this app exposes nothing to the page" is a decision that is visible in the
 * repository and in the build output.
 *
 * Anything added here goes across `contextBridge` and is therefore part of the app's public surface to
 * the hub console — so it needs the same review as an API route, not the same review as a UI helper.
 * The kiosk shell needs none: the console is a web app talking to its own origin over `/api`.
 */

// Intentionally empty. See the note above.
export {};
