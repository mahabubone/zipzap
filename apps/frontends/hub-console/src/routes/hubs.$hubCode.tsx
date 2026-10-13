import { createFileRoute } from '@tanstack/react-router';
import { HubLayout } from './hubs.$hubCode/layout.tsx';

export const Route = createFileRoute('/hubs/$hubCode')({
  component: () => <HubLayout />,
});
