import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MoneyText } from './MoneyText.tsx';

/**
 * The one component where a rendering bug is a money bug.
 *
 * Money crosses the wire as integer minor units (`125050` poisha) and must leave the screen as
 * the same integer, re-joined. The obvious implementation — `Intl.NumberFormat.format(n / 100)`
 * — is a float, and floats cannot hold every integer: the nearest double to `Number.MAX_SAFE_INTEGER`
 * is 1/100 of a minor unit short, so the largest representable amount renders a poisha low.
 *
 * Every assertion here compares against a BigInt reference rather than a hand-typed literal, so
 * a change in the grouping locale shows up as a failure instead of a silently different string.
 */

/** Exact major/minor split in BigInt space. The thing the component must agree with. */
function exact(amountMinor: number, scale = 100): string {
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(amountMinor));
  const major = (absolute / BigInt(scale)).toLocaleString('en-US');
  const minor = (absolute % BigInt(scale)).toString().padStart(2, '0');
  return `${sign}${major}.${minor}`;
}

/** Text content of the rendered span, minus the currency symbol the component prefixes. */
function amount(rendered: HTMLElement): string {
  return (rendered.textContent ?? '').replace(/^[^\d-]+/, '').trim();
}

describe('MoneyText', () => {
  test('renders integer minor units as major units with the currency symbol', () => {
    // The doc comment's own example, and the number the backend's format() spec asserts on.
    render(<MoneyText amountMinor={125050} currency="BDT" />);
    expect(screen.getByText(/1,250\.50/)).toBeInTheDocument();
    expect(screen.getByText(/1,250\.50/).textContent).toBe('৳ 1,250.50');
  });

  test('keeps both fraction digits when the minor part is a single digit', () => {
    // 5 poisha is 0.05, not 0.5. A `padStart` dropped here is a visible undercharge.
    render(<MoneyText amountMinor={5} currency="BDT" />);
    expect(amount(screen.getByText(/0\.05/))).toBe('0.05');
    render(<MoneyText amountMinor={7} currency="USD" />);
    expect(amount(screen.getByText(/\$ 0\.07/))).toBe('0.07');
    render(<MoneyText amountMinor={99} currency="BDT" />);
    expect(amount(screen.getByText(/0\.99/))).toBe('0.99');
  });

  test('zero is 0.00 and not an empty fraction', () => {
    render(<MoneyText amountMinor={0} currency="BDT" />);
    expect(screen.getByText('৳ 0.00')).toBeInTheDocument();
  });

  test('negatives carry the sign ahead of the grouped digits, after the symbol', () => {
    // A refund ledger reads `৳ -1,250.50`. The symbol stays put; the sign moves in front of the
    // number, so the two never read as `৳-` glued to a positive amount.
    render(<MoneyText amountMinor={-125050} currency="BDT" />);
    expect(screen.getByText('৳ -1,250.50')).toBeInTheDocument();
  });

  test('negatives below one major unit do not borrow a leading zero', () => {
    render(<MoneyText amountMinor={-5} currency="BDT" />);
    expect(screen.getByText('৳ -0.05')).toBeInTheDocument();
  });

  test('groups thousands', () => {
    render(<MoneyText amountMinor={123456789} currency="BDT" />);
    expect(screen.getByText('৳ 1,234,567.89')).toBeInTheDocument();
  });

  test('never renders a float artefact across the whole safe-integer range', () => {
    // The regression this file exists for. Sweeps magnitudes rather than hand-picked values:
    // the bug lives only at the top of the range, where `n / 100` stops being representable.
    // Volume is deliberately modest — what matters is that every one of the 53 magnitudes is
    // sampled, not how many samples land in each. More would cost jsdom time, not coverage.
    let seed = 20261012;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2_147_483_648;
      return seed;
    };

    const cases = new Set<number>([0, 1, 5, 99, 100, 125050]);
    while (cases.size < 1_200) {
      const magnitude = next() % 53;
      const value = Math.floor((next() / 2_147_483_648) * 2 ** magnitude);
      cases.add(value);
      cases.add(-value);
    }
    cases.add(Number.MAX_SAFE_INTEGER);
    cases.add(-Number.MAX_SAFE_INTEGER);

    const safe = [...cases].filter(Number.isSafeInteger);
    const { container } = render(
      <>
        {safe.map((value) => (
          <MoneyText key={value} amountMinor={value} currency="BDT" />
        ))}
      </>,
    );
    const spans = [...container.querySelectorAll('span')];
    expect(spans).toHaveLength(safe.length);

    const wrong = safe
      .map((value, i) => [value, amount(spans[i] as HTMLElement)] as const)
      .filter(([value, rendered]) => rendered !== exact(value));
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(wrong).toHaveLength(0);
  });

  test('the largest safe integer keeps its final minor unit', () => {
    // Explicit, so the failure names the number rather than "one of 40,006 cases".
    // `Number.MAX_SAFE_INTEGER / 100` is 90071992547409.9 — a float that formats to `.90`.
    render(<MoneyText amountMinor={Number.MAX_SAFE_INTEGER} currency="BDT" />);
    expect(screen.getByText('৳ 90,071,992,547,409.91')).toBeInTheDocument();
  });

  test('never renders a float-looking artefact for any safe integer', () => {
    // Belt and braces on the failure mode itself rather than a value: a float leaking into the
    // output shows up as an exponent, a trailing run of garbage digits, or a long decimal tail.
    for (const value of [125050, 1, 99, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      const { container, unmount } = render(<MoneyText amountMinor={value} currency="BDT" />);
      const text = container.querySelector('span')?.textContent ?? '';
      expect(text).not.toMatch(/[eE][+-]?\d/);
      expect(text).not.toMatch(/\d{4,}\.\d/);
      unmount();
    }
  });

  test('uses each currency its own symbol', () => {
    render(<MoneyText amountMinor={125050} currency="BDT" />);
    render(<MoneyText amountMinor={125050} currency="USD" />);
    render(<MoneyText amountMinor={125050} currency="EUR" />);
    expect(screen.getByText('৳ 1,250.50')).toBeInTheDocument();
    expect(screen.getByText('$ 1,250.50')).toBeInTheDocument();
    expect(screen.getByText('€ 1,250.50')).toBeInTheDocument();
  });

  test('all three currencies are 2-decimal, so the split does not depend on the code', () => {
    // Documents the assumption the `padStart` rests on. A future zero-decimal currency has to
    // come with its own formatter rather than inheriting `.00`.
    for (const currency of ['BDT', 'USD', 'EUR'] as const) {
      const { container, unmount } = render(
        <MoneyText amountMinor={123456789} currency={currency} />,
      );
      expect(amount(container.querySelector('span') as HTMLElement), currency).toBe('1,234,567.89');
      unmount();
    }
  });

  test('className lands on the span so callers can style the amount inline', () => {
    const { container } = render(
      <MoneyText amountMinor={100} currency="BDT" className="font-bold" />,
    );
    expect(container.querySelector('span')).toHaveClass('font-bold');
  });
});
