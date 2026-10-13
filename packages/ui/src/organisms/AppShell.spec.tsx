import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AppShell } from './AppShell.tsx';

/**
 * The shell is the only part of the kit every app renders, so its defects are every app's defects.
 *
 * These tests are about the two that a visual review cannot catch, because both look correct: the
 * closed mobile drawer was in the tab order while being translated off-screen, and the toggle's
 * glyph never changed while its accessible name did.
 */

const NAV = [
  {
    label: 'Operate',
    items: [
      { label: 'Shipments', href: '/app/shipments' },
      { label: 'Settlements', href: '/app/settlements' },
    ],
  },
];

/**
 * jsdom has no `matchMedia`, so a docked-viewport test has to supply one before the component
 * mounts — the shell reads it in an effect, and stubbing afterwards is stubbing a listener nobody
 * registered.
 */
function stubViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function shell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell brand="ZipZap" nav={NAV} {...props}>
      <main>Content</main>
    </AppShell>,
  );
}

describe('AppShell', () => {
  test('a closed drawer is inert, so it is not in the tab order', () => {
    const { container } = shell();
    const aside = container.querySelector('aside');
    // `inert` is what a translated-off-screen drawer was missing: it hid the navigation visually and
    // left every link inside reachable by keyboard.
    expect(aside).toHaveAttribute('inert');
  });

  test('opening the drawer takes it out of inert', async () => {
    const user = userEvent.setup();
    const { container } = shell();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');
  });

  test('the toggle’s picture follows its state', async () => {
    const user = userEvent.setup();
    const { container } = shell();
    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    const lines = () =>
      (container.querySelector('aside')?.getAttribute('class') ?? '') +
      String(toggle.querySelector('path')?.getAttribute('d'));

    // The label said "Close navigation" while the glyph was still three horizontal lines, so the
    // control lied to exactly the user who cannot read the label.
    expect(lines()).toContain('M3 6h14');
    await user.click(toggle);
    expect(lines()).not.toContain('M3 6h14');
    expect(lines()).toContain('M5 5l10 10');
  });

  test('the sidebar is not inert once the viewport is wide enough to dock it', async () => {
    // `inert` on a docked sidebar would take a real navigation away from every desktop user, so the
    // breakpoint has to be part of the decision rather than a CSS afterthought.
    stubViewport(true);
    const view = shell();
    await waitFor(() => expect(view.container.querySelector('aside')).not.toHaveAttribute('inert'));
  });

  test('the sidebar is inert on a phone-width viewport', async () => {
    stubViewport(false);
    const view = shell();
    await waitFor(() => expect(view.container.querySelector('aside')).toHaveAttribute('inert'));
  });

  test('the navigation is a labelled landmark', () => {
    shell();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  test('the current page is announced, not only coloured', () => {
    render(
      <AppShell
        brand="ZipZap"
        nav={[{ items: [{ label: 'Shipments', href: '/app/shipments', active: true }] }]}
      >
        <main>Content</main>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Shipments' })).toHaveAttribute('aria-current', 'page');
  });
});
