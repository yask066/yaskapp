import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { RouterProvider } from 'react-router-dom';
import { createQueryClient } from './query-client';
import { router } from './router';
import { SessionProvider } from './session-provider';
import { NotificationProvider } from '../features/notifications/notification-store';
import { MotionSettingsProvider } from '../core/motion/motion-settings';
import type { MotionFlags } from '../core/motion/motion-settings-context';

const appMotionFlags: MotionFlags = {
  reactionsMotion: import.meta.env.VITE_REACTIONS_MOTION === 'true',
  entryMotion: import.meta.env.VITE_ENTRY_MOTION === 'true',
};

export function App(): JSX.Element {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionSettingsProvider flags={appMotionFlags}>
        <SessionProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
          </NotificationProvider>
        </SessionProvider>
      </MotionSettingsProvider>
    </QueryClientProvider>
  );
}
