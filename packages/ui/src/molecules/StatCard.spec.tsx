import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MoneyText } from '../atoms/MoneyText.tsx';
import { StatCard } from './StatCard.tsx';

/**
 * A KPI tile is a label, a number, and optionally a trend line. Two failure modes are worth
 * guarding: the label is uppercased in CSS, so a test that asserts on text must not be fooled
 * by `text-transform`; and the value is a `ReactNode`, so it can be a `MoneyText` — which is
 * where the minor-unit bug from that component would surface here too.
 */

describe('StatCard', () => {
  test('shows the label and the value', () => {
    render(<StatCard label="Deliveries today" value="142" />);
    expect(screen.getByText('Deliveries today')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  test('renders the hint when given', () => {
    render(<StatCard label="Deliveries today" value="142" hint="vs 130 yesterday" />);
    expect(screen.getByText('vs 130 yesterday')).toBeInTheDocument();
  });

  test('omits the hint entirely when absent', () => {
    const { container } = render(<StatCard label="Deliveries today" value="142" />);
    // No empty paragraph left behind — a screen reader would announce a blank line per tile.
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  test('treats an empty hint as no hint', () => {
    const { container } = render(<StatCard label="Deliveries today" value="142" hint="" />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  test('accepts a node as the value, which is how money gets into a KPI', () => {
    render(
      <StatCard
        label="COD collected"
        value={<MoneyText amountMinor={184250075} currency="BDT" />}
        hint="Today"
      />,
    );
    expect(screen.getByText('৳ 1,842,500.75')).toBeInTheDocument();
  });

  test('renders a zero value rather than treating it as absent', () => {
    // `value && ...` instead of a truthiness check would drop 0 — the most-missed KPI.
    render(<StatCard label="Failed deliveries" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  test('renders an empty-string value without collapsing the tile', () => {
    render(<StatCard label="Failed deliveries" value="" hint="No data" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  test('renders a zero money amount as 0.00, not as a blank', () => {
    render(<StatCard label="Outstanding" value={<MoneyText amountMinor={0} currency="BDT" />} />);
    expect(screen.getByText('৳ 0.00')).toBeInTheDocument();
  });

  test('label, value and hint are all present together', () => {
    render(<StatCard label="On-time rate" value="96.4%" hint="Target 95%" />);
    expect(screen.getByText('On-time rate')).toBeInTheDocument();
    expect(screen.getByText('96.4%')).toBeInTheDocument();
    expect(screen.getByText('Target 95%')).toBeInTheDocument();
  });
});
