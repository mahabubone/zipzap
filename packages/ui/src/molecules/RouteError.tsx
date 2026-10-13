import { Button } from '../atoms/Button.tsx';
import { cx } from '../lib/cx.ts';

export interface RouteErrorProps {
  /** Whatever the router threw. `unknown`, because in practice it is anything. */
  readonly error: unknown;
  /** Re-run the failed load. Omitted when there is nothing to re-run. */
  readonly reset?: () => void;
  readonly title?: string;
  readonly className?: string;
}

/**
 * The sentence a thrown value earns.
 *
 * Anything that is not an `Error` is a thrown non-error — `throw 'not found'`, a rejected string from
 * a library, a value from a `JSON.parse` in somebody's edge case. Rendering it raw puts
 * `[object Object]` on screen, which tells a user nothing and a developer nothing either.
 *
 * So a non-Error becomes a plain sentence, and an `Error` is shown by its own message. Nothing else
 * is introspected: no stacks, no `error.code`, no attempt to reconstruct an API envelope. A stack on
 * an error screen is a security disclosure dressed as a debugging aid.
 */
export function routeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Something went wrong on our side. Nothing was saved.';
}

export function RouteError({
  error,
  reset,
  title = 'Something went wrong',
  className,
}: RouteErrorProps) {
  return (
    <div
      // `role="alert"`: this replaces the content the user asked for, and they need to be told
      // without hunting for what changed.
      role="alert"
      className={cx(
        'mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center',
        className,
      )}
    >
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-3 text-sm text-slate-600">{routeErrorMessage(error)}</p>
      {reset ? (
        <Button variant="secondary" className="mt-6" onClick={reset}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
