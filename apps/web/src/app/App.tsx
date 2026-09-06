import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { RouterProvider } from 'react-router-dom';
import { createQueryClient } from './query-client';
import { router } from './router';
import { SessionProvider } from './session-provider';

export function App(): JSX.Element {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  );
}
