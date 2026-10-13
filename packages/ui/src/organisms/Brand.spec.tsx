import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BrandMark, Wordmark } from './Brand.tsx';

/**
 * A brand mark is the one component nobody wants to touch and everybody changes anyway.
 *
 * These assertions are the ones that would notice a bad change rather than a changed one: the mark is
 * decorative, the wordmark is the accessible name, and a surface that must not say "ZipZap" can say
 * something else without forking the component.
 */

describe('BrandMark', () => {
  test('is hidden from assistive technology', () => {
    // The name is always on screen next to it. A screen reader announcing "graphic" before every
    // header is noise, and the reason it happened before was a missing `aria-hidden` on a decorative
    // svg — the one defect a visual review cannot see.
    const { container } = render(<BrandMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('is not focusable', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });

  test('takes a size class, because every caller wants a different one', () => {
    const { container } = render(<BrandMark className="size-11" />);
    expect(container.querySelector('svg')).toHaveClass('size-11');
  });
});

describe('Wordmark', () => {
  test('carries the product name as text', () => {
    render(<Wordmark />);
    expect(screen.getByText('ZipZap')).toBeVisible();
  });

  test('says what the surface asks it to say', () => {
    // A partner's deployment, or a screen where the brand must not be assumed. Forking a nine-line
    // component to change one word is how four copies drift apart.
    render(<Wordmark name="Acme Logistics" />);
    expect(screen.getByText('Acme Logistics')).toBeVisible();
  });

  test('renders the mark alongside the name, and the mark stays decorative', () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
    expect(screen.getByText('ZipZap')).toBeVisible();
  });
});
