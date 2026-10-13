import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Button } from './Button.tsx';

/**
 * Guards the two ways a shared button breaks every screen at once: it fires a handler the
 * caller thought was impossible, or it submits a form the caller did not know it was inside.
 *
 * Deliberately no class-name assertions. `variant` and `size` are pure Tailwind lookups with
 * no branching worth a test; what is worth pinning is that the props reach the DOM element,
 * because `{...rest}` is spread *after* the internal className and a reordering would silently
 * drop caller props.
 */

describe('Button', () => {
  test('renders its children and is reachable by role', () => {
    render(<Button>Create shipment</Button>);
    expect(screen.getByRole('button', { name: 'Create shipment' })).toBeInTheDocument();
  });

  test('calls onClick when enabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a disabled button does not fire onClick', async () => {
    // The regression class: a bulk-action bar disables "Confirm COD" while a request is in
    // flight. If `disabled` stopped suppressing the handler, a double-tap collects COD twice.
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Confirm COD
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm COD' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a disabled button exposes the disabled state to assistive tech', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('defaults to type="button", so a bare button in a form does not submit it', async () => {
    // It used to inherit the HTML default of `submit`, and two sibling tests pinned that as a
    // feature: "a bare `<Button>Save</Button>` in a form must still work".
    //
    // That is true of every form in this product, and every one of them states `type="submit"` on
    // the button that submits — so the default bought nothing. What it cost was real: an
    // `ErrorState`'s Retry or an `EmptyState`'s action inside a create-shipment form submitted it,
    // and the merchant lost the draft they had just typed. The fix belongs in the component that
    // caused it, so it happened here rather than in three molecules.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button>Save</Button>
      </form>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('an explicit type overrides the default in both directions', async () => {
    // A "Cancel" button inside a create-shipment form must not submit it.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="button">Cancel</Button>
      </form>,
    );

    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.setup().click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('a submit button inside a real form actually submits', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('every variant and size renders without dropping the children', () => {
    // Not a class-name assertion — a missing key in the `variants`/`sizes` record would render
    // `undefined` as a class and nothing else would notice.
    render(
      <>
        {(['primary', 'secondary', 'ghost', 'destructive'] as const).map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        {(['sm', 'md'] as const).map((size) => (
          <Button key={size} size={size}>
            {size}
          </Button>
        ))}
      </>,
    );
    for (const name of ['primary', 'secondary', 'ghost', 'destructive', 'sm', 'md']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  test('forwards arbitrary DOM props, including aria and data attributes', () => {
    // `{...rest}` is spread last, so this also pins that callers can override anything the
    // component sets internally.
    render(
      <Button aria-label="Close dialog" data-testid="x" id="close-btn">
        <span aria-hidden>×</span>
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Close dialog' });
    expect(button).toHaveAttribute('data-testid', 'x');
    expect(button).toHaveAttribute('id', 'close-btn');
  });

  test('an icon-only button is still namable via aria-label', () => {
    render(
      <Button aria-label="Delete shipment">
        <svg aria-hidden />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Delete shipment' })).toBeInTheDocument();
  });

  test('aria-busy marks a button that is saving without hiding its label', () => {
    // The loading pattern for forms: keep the label so the button does not change width, and
    // announce the pending state rather than swapping in a spinner with no name.
    render(
      <Button aria-busy="true" aria-live="polite">
        Saving…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-live', 'polite');
  });

  test('merges a caller className rather than replacing the base classes', () => {
    render(<Button className="w-full">Full width</Button>);
    const button = screen.getByRole('button', { name: 'Full width' });
    expect(button).toHaveClass('w-full');
    expect(button.className).toContain('inline-flex');
  });
});
