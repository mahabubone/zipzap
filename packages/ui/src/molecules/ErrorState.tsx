import { Button } from '../atoms/Button.tsx';

export interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly retry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, retry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
      <p className="font-medium text-red-800">{title}</p>
      <p className="max-w-sm text-sm text-red-600">{message}</p>
      {retry ? (
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
