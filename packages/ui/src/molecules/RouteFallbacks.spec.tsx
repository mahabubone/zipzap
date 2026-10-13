import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { NotFound } from './NotFound.tsx';
import { RouteError, routeErrorMessage } from './RouteError.tsx';

/**
 * These two render when a route has already failed — no session, no data, no app around them. So the
 * test is about what they say when there is nothing to work with, which is the only time anybody
 * sees them.
 */

describe('NotFound', () => {
  test('says what was missing and offers a way out', () => {
    render(
      <NotFound
        subject="that tracking code"
        description="Tracking codes look like ZP-8F32A1."
        action={<a href="/track">Track another parcel</a>}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /we could not find that tracking code/i }),
    ).toBeVisible();
    expect(screen.getByText('Tracking codes look like ZP-8F32A1.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Track another parcel' })).toBeVisible();
  });

  test('falls back to a subject that still reads as a sentence', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: /we could not find that page/i })).toBeVisible();
  });

  test('a 404 without an action is still a sentence, not a dead end with no explanation', () => {
    render(<NotFound subject="that shipment" />);
    expect(screen.getByText(/not found/i)).toBeVisible();
  });
});

describe('routeErrorMessage', () => {
  test('shows an Error by its own message', () => {
    expect(routeErrorMessage(new Error('Rate limit exceeded'))).toBe('Rate limit exceeded');
  });

  test('never renders a non-Error as an object literal', () => {
    // `throw 'not found'` and a rejected string from a library both land here. Rendering them raw
    // puts `[object Object]` or a bare word on screen, which tells a user nothing and looks like the
    // app has thrown itself away.
    expect(routeErrorMessage('not found')).toBe(
      'Something went wrong on our side. Nothing was saved.',
    );
    expect(routeErrorMessage({ status: 500 })).toBe(
      'Something went wrong on our side. Nothing was saved.',
    );
  });

  test('an empty message is treated as no message', () => {
    // `new Error('')` renders as an empty paragraph, which reads as a rendering failure rather than a
    // message that did not load.
    expect(routeErrorMessage(new Error('   '))).toBe(
      'Something went wrong on our side. Nothing was saved.',
    );
  });

  test('never leaks a stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at /srv/app/dist/main.js:1:1';
    expect(routeErrorMessage(error)).not.toContain('/srv/app');
  });
});

describe('RouteError', () => {
  test('announces itself, because it replaced the screen the user asked for', () => {
    render(<RouteError error={new Error('Shipment not found')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Shipment not found');
  });

  test('offers a retry only when there is something to retry', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const { rerender } = render(<RouteError error={new Error('boom')} reset={reset} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);

    // No reset means no button: a "Try again" that reloads nothing is a promise the screen cannot keep.
    rerender(<RouteError error={new Error('boom')} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  test('the retry does not submit an enclosing form', () => {
    // The kit-wide `Button` default, asserted here because this is the one error screen that can
    // appear inside a page with a form on it.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <RouteError error={new Error('boom')} reset={() => {}} />
      </form>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('type', 'button');
  });
});
