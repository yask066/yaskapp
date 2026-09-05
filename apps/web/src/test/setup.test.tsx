import { useQueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './setup';

function CacheProbe({ writeToCache }: { writeToCache: boolean }) {
  const queryClient = useQueryClient();

  if (writeToCache) {
    queryClient.setQueryData(['cache-probe'], 'retained value');
  }

  return <output>{queryClient.getQueryData(['cache-probe']) ?? 'cache is empty'}</output>;
}

test('preserves query cache data when renderWithProviders rerenders', () => {
  const view = renderWithProviders(<CacheProbe writeToCache />);

  expect(screen.getByRole('status')).toHaveTextContent('retained value');

  view.rerender(<CacheProbe writeToCache={false} />);

  expect(screen.getByRole('status')).toHaveTextContent('retained value');
});
