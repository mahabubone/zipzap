/** Join class names, dropping falsy parts. The only "util" the kit needs. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
