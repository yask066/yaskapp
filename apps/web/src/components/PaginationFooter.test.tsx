import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PaginationFooter } from './PaginationFooter';

const baseProps = {
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  paginationSupported: true,
  automaticLoadEnabled: false,
  onLoadMore: vi.fn(),
};

test('keeps the keyboard action focused while loading and after an append error', async () => {
  const user = userEvent.setup();
  const onLoadMore = vi.fn();
  const { rerender } = render(<PaginationFooter {...baseProps} onLoadMore={onLoadMore} />);
  await user.tab();
  const loadMore = screen.getByRole('button', { name: 'Load more' });
  expect(loadMore).toHaveFocus();

  await user.keyboard('{Enter}');
  expect(onLoadMore).toHaveBeenCalledWith('manual');
  rerender(<PaginationFooter {...baseProps} isFetchingNextPage onLoadMore={onLoadMore} />);
  expect(loadMore).toHaveAttribute('aria-disabled', 'true');
  expect(loadMore).not.toBeDisabled();
  expect(loadMore).toHaveFocus();

  await user.keyboard('{Enter}');
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  rerender(<PaginationFooter {...baseProps} isFetchNextPageError error={new Error('append failed')} onLoadMore={onLoadMore} />);
  const retry = screen.getByRole('button', { name: 'Retry loading more' });
  expect(screen.getByRole('alert')).toHaveTextContent('append failed');
  expect(retry).toHaveFocus();

  await user.keyboard('{Enter}');
  expect(onLoadMore).toHaveBeenLastCalledWith('manual');
  expect(onLoadMore).toHaveBeenCalledTimes(2);
});
