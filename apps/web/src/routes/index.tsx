import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@zipzap/ui';

export const Route = createFileRoute('/')({
  component: () => (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">ZipZap</h1>
      <p className="text-slate-600">
        Logistics operating system for e-commerce merchants, riders and hubs — Bangladesh first.
      </p>
      <Link to="/login">
        <Button>Sign in to your console</Button>
      </Link>
    </main>
  ),
});
