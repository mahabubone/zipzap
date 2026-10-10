import { createMiddleware } from '@tanstack/react-start';

/**
 * The incoming request, made available to server functions.
 *
 * This is the only place in TanStack Start 1.168 where it can be read: a `createServerFn` handler's
 * context carries `data`, `serverFnMeta` and `context`, but not the request — so
 * `request.headers` in a handler simply does not compile. Global request middleware receives it and
 * runs for both page loads and server-function calls, which is the actual requirement.
 *
 * What it copies is deliberately small: the `Origin` and the `Cookie` header. Nothing else about
 * the request needs to survive the hop.
 */
export interface RequestContext {
  /** The origin the request arrived on, so a relative `/api` base URL can be resolved. */
  readonly origin: string;
  /** The raw `Cookie` header, carrying `zipzap_session`. */
  readonly cookie: string;
}

export const withRequestContext = createMiddleware({ type: 'request' }).server(
  ({ request, next }) => {
    // `Origin` is absent on a plain top-level GET navigation, which is exactly the case the console
    // guard runs in — so fall back to the request's own URL, which is always this origin.
    const context: RequestContext = {
      origin: request.headers.get('origin') ?? new URL(request.url).origin,
      cookie: request.headers.get('cookie') ?? '',
    };
    return next({ context });
  },
);
