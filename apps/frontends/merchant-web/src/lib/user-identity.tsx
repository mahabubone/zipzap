import { Avatar, Button } from '@zipzap/ui';

/**
 * The signed-in person, in the sidebar footer.
 *
 * This renders in every authenticated screen, which makes it the most-reproduced element in the
 * product — and it used to be a raw UUID. `subjectId` is correct and unreadable, and the natural
 * reading of `c9efcce5-3693-4739-9fd7-fe6b1dc4672f` above a sign-out button is "this is a
 * developer tool" rather than "this is a product a merchant uses". Nobody reads a UUID, and the one
 * place on screen whose entire job is answering "who am I" was the one place that did not.
 *
 * So: a monogram derived from the name, the name, and the email — with the account type stated
 * when it is not a human. `Avatar` already existed in the kit and had no call site, which is the
 * other half of the story: a design system with an unused component is a design system nobody
 * looked at.
 *
 * The email is what makes this trustworthy rather than decorative. A name can be anything; a name
 * next to the address that receives the account's notifications is an identity you can check.
 */
export function UserIdentity({
  displayName,
  email,
  kind,
  onSignOut,
}: {
  /** Null for a machine principal — an API key has no person to greet. */
  readonly displayName: string | null;
  readonly email: string | null;
  readonly kind: 'human' | 'machine';
  readonly onSignOut: () => void;
}) {
  // A machine key gets a different mark, not the same one with a missing name. Conflating "signed
  // in as a person" and "signed in as a key" in one slot is how an integration ends up believing it
  // has a user session it does not have.
  if (kind === 'machine') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-white"
          >
            AK
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700">API key</p>
            <p className="truncate text-[11px] text-slate-500">Machine principal</p>
          </div>
        </div>
        <SignOutButton onClick={onSignOut} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar name={displayName ?? email ?? '?'} className="size-8 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-700">
            {displayName ?? 'Signed in'}
          </p>
          {email ? <p className="truncate text-[11px] text-slate-500">{email}</p> : null}
        </div>
      </div>
      <SignOutButton onClick={onSignOut} />
    </div>
  );
}

function SignOutButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      Sign out
    </Button>
  );
}
