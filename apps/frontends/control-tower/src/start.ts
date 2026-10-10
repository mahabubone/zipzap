import { createStart } from '@tanstack/react-start';
import { withRequestContext } from './lib/request-context.ts';

/**
 * Registers the request-context middleware globally.
 *
 * It must be global, not per-route: the auth guard lives in a `beforeLoad` that calls a server
 * function, and a middleware attached to that function's own builder is not the same object the
 * global request pipeline runs. Without this the context is `undefined`, the server function asks
 * the API who you are without presenting the cookie, and every signed-in visitor is redirected to
 * /login.
 *
 * A 307 that looks exactly like an intentional redirect is the whole failure mode here — there is
 * no console error and nothing in the network tab but a redirect. Worth remembering before
 * "simplifying" this file away.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [withRequestContext],
}));
