import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs.tsx';

/**
 * `Tabs` is fully controlled — the caller owns `value` — so the only thing to guard is that the
 * selected state actually follows the prop and that `onChange` reports an id, not an index or an
 * event. An index would survive every rename of the tab ids and silently select the wrong panel.
 *
 * `TabPanel` is the other half: it renders `null` unless `value === when`. Getting that
 * comparison wrong is how two panels end up showing at once, which on a settings page means a
 * merchant edits a form they cannot see.
 */

const ITEMS = [
  { id: 'pending', label: 'Pending' },
  { id: 'transit', label: 'In transit' },
  { id: 'done', label: 'Delivered' },
];

describe('Tabs', () => {
  test('exposes a tablist with one tab per item', () => {
    render(<Tabs items={ITEMS} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  test('renders each tab by its label', () => {
    render(<Tabs items={ITEMS} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'In transit' })).toBeInTheDocument();
  });

  test('marks exactly one tab selected', () => {
    render(<Tabs items={ITEMS} value="transit" onChange={() => {}} />);
    const selected = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('In transit');
  });

  test('an unselected tab reports aria-selected="false" explicitly', () => {
    // Omitting the attribute would leave it to the ARIA default, which some screen readers treat
    // as false and others ignore entirely.
    render(<Tabs items={ITEMS} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Delivered' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('reports the tab id on click, not the index', async () => {
    // The id contract. An index would break the moment a tab is inserted or reordered, and
    // would keep working in every test written against it.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} value="pending" onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: 'Delivered' }));
    expect(onChange).toHaveBeenCalledWith('done');
    expect(onChange).not.toHaveBeenCalledWith(expect.any(Number));
  });

  test('selection round-trips through state', async () => {
    function TabsHost() {
      const [value, setValue] = useState('pending');
      return (
        <>
          <Tabs items={ITEMS} value={value} onChange={setValue} />
          <TabPanel value={value} when="done">
            Delivered list
          </TabPanel>
        </>
      );
    }
    const user = userEvent.setup();
    render(<TabsHost />);

    expect(screen.queryByText('Delivered list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Delivered' }));
    expect(screen.getByRole('tab', { name: 'Delivered' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Delivered list')).toBeInTheDocument();
  });

  test('a value matching no tab leaves every tab unselected', () => {
    // A stale id from a cached route. The component must not pick a default on the merchant's
    // behalf and show the wrong tab as selected.
    render(<Tabs items={ITEMS} value="cancelled" onChange={() => {}} />);
    const selected = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(0);
  });

  test('renders a badge alongside the label', () => {
    render(
      <Tabs
        items={[{ id: 'pending', label: 'Pending', badge: 12 }]}
        value="pending"
        onChange={() => {}}
      />,
    );
    const tab = screen.getByRole('tab', { name: /Pending/ });
    expect(tab).toHaveTextContent('12');
  });

  test('a tab with no badge shows only its label', () => {
    render(<Tabs items={ITEMS} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveTextContent('Pending');
  });

  test('a badge of zero is treated as no badge', () => {
    // `{t.badge ? ... : null}` drops 0. Harmless here — an empty list shows no count — but worth
    // pinning so nobody "fixes" it into a truthiness check that renders "0" on every empty tab.
    render(
      <Tabs
        items={[{ id: 'pending', label: 'Pending', badge: 0 }]}
        value="pending"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveTextContent('Pending');
  });

  test('tabs are buttons, so they are keyboard-operable', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} value="pending" onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  test('renders an empty tablist without crashing', () => {
    render(<Tabs items={[]} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('TabPanel', () => {
  test('renders its children when the value matches', () => {
    render(
      <TabPanel value="pending" when="pending">
        Pending list
      </TabPanel>,
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Pending list');
  });

  test('renders nothing when the value does not match', () => {
    render(
      <TabPanel value="done" when="pending">
        Pending list
      </TabPanel>,
    );
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending list')).not.toBeInTheDocument();
  });

  test('exactly one of several panels renders for any given value', () => {
    // Two panels visible at once on a settings page means a merchant edits a form they cannot
    // see, so this is asserted as a set rather than panel by panel.
    render(
      <>
        <TabPanel value="a" when="a">
          Panel A
        </TabPanel>
        <TabPanel value="a" when="b">
          Panel B
        </TabPanel>
        <TabPanel value="a" when="c">
          Panel C
        </TabPanel>
      </>,
    );
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveTextContent('Panel A');
  });

  test('no panel renders when the value matches none', () => {
    render(
      <>
        <TabPanel value="z" when="a">
          Panel A
        </TabPanel>
        <TabPanel value="z" when="b">
          Panel B
        </TabPanel>
      </>,
    );
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(0);
  });
});
