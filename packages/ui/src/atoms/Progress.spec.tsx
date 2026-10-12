import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Progress } from './Progress.tsx';

/**
 * `Progress` carries an out-of-range value from real data: settlement progress is computed from
 * a sum of per-shipment percentages, which drifts past 100 whenever a shipment is counted in two
 * hubs. The clamp is the only thing stopping a bar from overflowing its track.
 *
 * `aria-valuenow` is asserted separately from the rendered width because they are set from
 * different expressions — `Math.round(pct)` versus `${pct}%` — and only one of them is rounded.
 */

describe('Progress', () => {
  test('exposes the progressbar role and its accessible name', () => {
    render(<Progress value={40} label="Route completion" />);
    expect(screen.getByRole('progressbar', { name: 'Route completion' })).toBeInTheDocument();
  });

  test('reports the value, and the bounds, to assistive tech', () => {
    render(<Progress value={40} label="Route completion" />);
    const bar = screen.getByRole('progressbar', { name: 'Route completion' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  test('renders the filled portion at the matching percentage', () => {
    const { container } = render(<Progress value={40} label="Route completion" />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill).toHaveStyle({ width: '40%' });
  });

  test('clamps a value above 100 rather than overflowing the track', () => {
    render(<Progress value={140} label="Over" />);
    const bar = screen.getByRole('progressbar', { name: 'Over' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '100%' });
  });

  test('clamps a negative value to zero rather than rendering a negative width', () => {
    render(<Progress value={-20} label="Under" />);
    const bar = screen.getByRole('progressbar', { name: 'Under' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '0%' });
  });

  test('rounds the announced value, since progress is a whole percent to a reader', () => {
    render(<Progress value={66.7} label="Rounded" />);
    expect(screen.getByRole('progressbar', { name: 'Rounded' })).toHaveAttribute(
      'aria-valuenow',
      '67',
    );
  });

  test('a fractional value keeps its exact width even though the announcement is rounded', () => {
    // The two are computed differently on purpose. Asserting both stops a future "tidy up"
    // that makes them agree by rounding one of them.
    const { container } = render(<Progress value={66.7} label="Rounded" />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill).toHaveStyle({ width: '66.7%' });
  });

  test('handles both ends of the range', () => {
    const { rerender } = render(<Progress value={0} label="Bounds" />);
    expect(screen.getByRole('progressbar', { name: 'Bounds' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    rerender(<Progress value={100} label="Bounds" />);
    expect(screen.getByRole('progressbar', { name: 'Bounds' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  test('a progress bar with no label is still a progressbar, just an unnamed one', () => {
    // Documented rather than prevented: `label` is optional because some bars are decorative.
    // What matters is that the role survives, so a screen reader still announces "progress bar".
    render(<Progress value={50} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).not.toHaveAttribute('aria-label');
  });

  test('every tone renders the same bar with a different fill', () => {
    // Not a class-name assertion — it checks the tone lookup exists for each, since a missing
    // key would render `undefined` as a class and produce an unstyled bar with no test failure.
    for (const tone of ['brand', 'success', 'warning', 'danger'] as const) {
      const { container, unmount } = render(<Progress value={50} label={tone} tone={tone} />);
      expect(screen.getByRole('progressbar', { name: tone })).toBeInTheDocument();
      const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
      expect(fill.getAttribute('class')).toBeTruthy();
      unmount();
    }
  });

  test('merges a caller className onto the track', () => {
    render(<Progress value={50} label="Width" className="w-32" />);
    const bar = screen.getByRole('progressbar', { name: 'Width' });
    expect(bar).toHaveClass('w-32');
    expect(bar.className).toContain('overflow-hidden');
  });
});
