import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Dropdown, DropdownCheck, DropdownItem, DropdownLabel } from './Dropdown.tsx';

/**
 * `Dropdown` is explicitly not a menu primitive — the doc comment says so. It is a div with a
 * click handler and two document listeners, and those listeners are the whole risk surface:
 * if the effect does not clean up, every subsequent click anywhere on the page closes an
 * unrelated dropdown, and `fireEvent` with a detached node leaves the listener holding a stale ref.
 *
 * The tests below cover open/close by all four routes (trigger, Escape, click-outside, item),
 * plus the unmount case that a memory leak would show up in.
 */

function openDropdown(children: ReactNode = 'Menu content') {
  const user = userEvent.setup();
  const view = render(
    <Dropdown trigger={<button type="button">Open</button>}>{children}</Dropdown>,
  );
  return { ...view, user };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

describe('Dropdown', () => {
  test('the trigger reports collapsed before it is opened', () => {
    openDropdown();
    // On the trigger element itself, not on a wrapper: `aria-expanded` on a roleless `<div>` is
    // never exposed, so a screen reader was told nothing when this menu opened.
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('the trigger reports expanded once opened', async () => {
    const { user } = openDropdown();
    await open(user);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('the trigger says it opens a menu', () => {
    openDropdown();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  test('children are not rendered until the dropdown is opened', async () => {
    const { user } = openDropdown('Menu content');
    expect(screen.queryByText('Menu content')).not.toBeInTheDocument();

    await open(user);
    expect(screen.getByText('Menu content')).toBeInTheDocument();
  });

  test('clicking the trigger again closes it', async () => {
    const { user } = openDropdown();
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Menu content')).not.toBeInTheDocument();
  });

  test('Escape closes the dropdown', async () => {
    const { user } = openDropdown();
    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Menu content')).not.toBeInTheDocument();
  });

  test('a click outside closes the dropdown', async () => {
    render(
      <>
        <Dropdown trigger={<button type="button">Open</button>}>Menu content</Dropdown>
        <button type="button">Elsewhere</button>
      </>,
    );
    const user = userEvent.setup();
    await open(user);
    expect(screen.getByText('Menu content')).toBeInTheDocument();

    // The listener is on `mousedown`, so a full click is what triggers it.
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByText('Menu content')).not.toBeInTheDocument();
  });

  test('a click inside the menu does not close it', async () => {
    const { user } = openDropdown(
      <button type="button" onClick={() => {}}>
        Inside item
      </button>,
    );
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Inside item' }));
    expect(screen.getByRole('button', { name: 'Inside item' })).toBeInTheDocument();
  });

  test('a function child receives a close callback that dismisses the menu', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        {(close) => (
          <button type="button" onClick={close}>
            Do it
          </button>
        )}
      </Dropdown>,
    );

    await open(user);
    await user.click(screen.getByRole('button', { name: 'Do it' }));
    expect(screen.queryByRole('button', { name: 'Do it' })).not.toBeInTheDocument();
  });

  test('the document listeners are removed on unmount', async () => {
    // The leak: a listener left on `document` closes a dropdown that no longer exists, and worse,
    // keeps firing `setOpen` on an unmounted component. Spying on `document` is the only way to
    // see this — the behaviour tests above pass either way.
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const user = userEvent.setup();

    const { unmount } = render(
      <Dropdown trigger={<button type="button">Open</button>}>Menu content</Dropdown>,
    );
    await open(user);

    const tracked = (spy: typeof addSpy): number =>
      spy.mock.calls.filter(([type]) => type === 'mousedown' || type === 'keydown').length;
    const added = tracked(addSpy);
    expect(added).toBe(2);

    // Still mounted and open: nothing to remove yet.
    expect(tracked(removeSpy)).toBe(0);

    unmount();
    expect(tracked(removeSpy)).toBe(added);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('closing an open dropdown removes its listeners too', async () => {
    // The other half. If only unmount cleaned up, every close-and-reopen would leak a pair, and
    // a page that opens a menu once per row click would accumulate thousands of listeners.
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const user = userEvent.setup();
    render(<Dropdown trigger={<button type="button">Open</button>}>Menu content</Dropdown>);

    const tracked = (spy: typeof addSpy): number =>
      spy.mock.calls.filter(([type]) => type === 'mousedown' || type === 'keydown').length;

    await open(user);
    expect(tracked(addSpy)).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(tracked(removeSpy)).toBe(2);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('no listeners are registered while the dropdown is closed', () => {
    // The `if (!open) return` guard. Without it, every dropdown on the page registers two
    // document listeners at mount and the page pays for it on every click forever.
    const addSpy = vi.spyOn(document, 'addEventListener');
    render(<Dropdown trigger={<button type="button">Open</button>}>Menu content</Dropdown>);
    const added = addSpy.mock.calls.filter(([type]) => type === 'mousedown' || type === 'keydown');
    expect(added).toHaveLength(0);
    addSpy.mockRestore();
  });

  test('renders the trigger exactly as passed, without wrapping it in another button', () => {
    render(<Dropdown trigger={<span data-testid="custom">Custom trigger</span>}>Menu</Dropdown>);
    // Documented contract: `trigger` is rendered as-is, so a caller can pass any focusable node.
    // If the component started wrapping it, `queryByRole('button')` would find one.
    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Custom trigger' })).not.toBeInTheDocument();
  });
});

describe('DropdownItem', () => {
  test('is exposed as a menuitem and fires onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownItem onSelect={onSelect}>Archive</DropdownItem>
      </Dropdown>,
    );

    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('a disabled item does not fire onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownItem onSelect={onSelect} disabled>
          Archive
        </DropdownItem>
      </Dropdown>,
    );

    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('is a button, so it never submits an enclosing form', async () => {
    const user = userEvent.setup();
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Dropdown trigger={<button type="button">Open</button>}>
          <DropdownItem onSelect={() => {}}>Archive</DropdownItem>
        </Dropdown>
      </form>,
    );

    await open(user);
    // Hardcoded `type="button"` on every DropdownItem — the same reason `Switch` sets it. A menu
    // item inside a settings form must not save the form.
    const item = screen.getByRole('menuitem', { name: 'Archive' });
    expect(item).toHaveAttribute('type', 'button');
  });

  test('a danger item is still a menuitem with the same accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownItem onSelect={() => {}} danger>
          Delete zone
        </DropdownItem>
      </Dropdown>,
    );

    await open(user);
    // `danger` is presentation only. If it ever changed the name or role, a merchant using a
    // screen reader would no longer hear "Delete zone" as the item they expect.
    expect(screen.getByRole('menuitem', { name: 'Delete zone' })).toBeInTheDocument();
  });
});

describe('DropdownCheck', () => {
  test('is a labelled checkbox wired to its label text', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownCheck checked onChange={() => {}}>
          COD column
        </DropdownCheck>
      </Dropdown>,
    );

    await open(user);
    // The `useId` + `htmlFor`/`id` pair is the whole mechanism; `getByRole` with a name only
    // resolves if it is correct.
    expect(screen.getByRole('checkbox', { name: 'COD column' })).toBeChecked();
  });

  test('reports the next checked state, as a boolean', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownCheck checked={false} onChange={onChange}>
          COD column
        </DropdownCheck>
      </Dropdown>,
    );

    await open(user);
    await user.click(screen.getByRole('checkbox', { name: 'COD column' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('reports false when an already-checked box is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownCheck checked onChange={onChange}>
          COD column
        </DropdownCheck>
      </Dropdown>,
    );

    await open(user);
    await user.click(screen.getByRole('checkbox', { name: 'COD column' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('each checkbox gets its own id, so two in one menu do not collide', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownCheck checked onChange={() => {}}>
          COD column
        </DropdownCheck>
        <DropdownCheck checked={false} onChange={() => {}}>
          Zone column
        </DropdownCheck>
      </Dropdown>,
    );

    await open(user);
    expect(screen.getByRole('checkbox', { name: 'COD column' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Zone column' })).not.toBeChecked();
  });
});

describe('DropdownLabel', () => {
  test('renders its text as a non-interactive label', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownLabel>Toggle columns</DropdownLabel>
      </Dropdown>,
    );

    await open(user);
    const label = screen.getByText('Toggle columns');
    expect(label).toBeInTheDocument();
    // A label must not be focusable or clickable, or tab order picks up a dead stop.
    expect(label).not.toHaveAttribute('tabindex');
  });
});
