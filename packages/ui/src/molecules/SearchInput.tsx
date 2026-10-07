import { Input } from '../atoms/Input.tsx';
import { cx } from '../lib/cx.ts';

export function SearchInput(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly name?: string;
  readonly className?: string;
}) {
  return (
    <Input
      type="search"
      aria-label="Search"
      name={props.name ?? 'search'}
      className={cx('w-64', props.className)}
      placeholder={props.placeholder ?? 'Search…'}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
