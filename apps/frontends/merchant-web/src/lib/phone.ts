/**
 * Bangladeshi phone → E.164, on the client.
 *
 * The server's regex is `/^\+8801[3-9]\d{8}$/` (see create-shipment.controller.ts).
 * A merchant typing `01712345678` — which is how every Bangladeshi phone number is
 * written and displayed — would be rejected by it. So the client normalises, and the
 * field shows what it will send.
 *
 * `tonumber:` this covers BD only, because the server does. A second country is a
 * second regex here and a second decision on the DTO; add it when there is a
 * deployment in that country, not before.
 */

/** `01712345678` / `+8801712345678` / `8801712345678` / `1712345678` → `+8801712345678`. */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Strip the punctuation people paste in: spaces, dashes, dots, parens.
  let digits = trimmed.replace(/[\s\-().]/g, '');

  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (digits.startsWith('+')) digits = `+${digits.slice(1)}`;
  else if (digits.startsWith('880')) digits = `+${digits}`;
  else if (digits.startsWith('0')) digits = `+880${digits.slice(1)}`;
  else digits = `+880${digits}`;

  // The one rule that is genuinely a rule: 880 then 1, then 3-9, then 8 digits.
  return /^\+8801[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** True when the input can be normalised — used to enable submit, not to validate. */
export function isValidBdPhone(input: string): boolean {
  return toE164(input) !== null;
}
