import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { deleteAccount, getAccountDeletionStatus, verifyAccountDeletion } from '../../api/account-deletion';
import { ApiError } from '../../api/client';
import { loadAccountDeletionReceipt, saveAccountDeletionReceipt } from './account-deletion-receipt';
import { AccountDeletionPage } from './AccountDeletionPage';
import { ProtectedRoute } from '../../app/router';

const completeAccountDeletion = vi.fn();
const setAccountDeletionPending = vi.fn(async () => undefined);
vi.mock('../../api/account-deletion', () => ({
  deleteAccount: vi.fn(),
  getAccountDeletionStatus: vi.fn(),
  verifyAccountDeletion: vi.fn(),
}));
vi.mock('../../app/session-provider', () => ({
  useOptionalSession: () => ({ status: 'anonymous', user: null, completeAccountDeletion, setAccountDeletionPending }),
  useSession: () => ({ status: 'anonymous' }),
}));

const verification = {
  operationId: 'operation-1', status: 'not_started' as const,
  deletionToken: 'deletion-secret', statusToken: 'status-secret',
  deletionTokenExpiresAt: '2026-10-13T21:00:00.000Z', statusTokenExpiresAt: '2026-10-15T20:00:00.000Z',
};
const pendingStatus = {
  operationId: 'operation-1', status: 'pending' as const,
  acceptedAt: '2026-10-13T20:00:00.000Z', deadlineAt: '2026-10-14T20:00:00.000Z', completedAt: null,
};

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/account-deletion']}>
        <Routes>
          <Route path="/account-deletion" element={<AccountDeletionPage />} />
          <Route path="/private" element={<h1>Private profile</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(verifyAccountDeletion).mockReset().mockResolvedValue(verification);
  vi.mocked(deleteAccount).mockReset().mockResolvedValue(pendingStatus);
  vi.mocked(getAccountDeletionStatus).mockReset().mockResolvedValue(pendingStatus);
  completeAccountDeletion.mockReset().mockResolvedValue(undefined);
  setAccountDeletionPending.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

test('wrong password is shown on the deletion form without signing out', async () => {
  vi.mocked(verifyAccountDeletion).mockRejectedValueOnce(Object.assign(new Error('The login or password is incorrect.'), { status: 403, code: 'invalid_credentials' }));
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'locked@example.com');
  await user.type(screen.getByLabelText('Password'), 'wrong');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('The login or password is incorrect.');
  expect(completeAccountDeletion).not.toHaveBeenCalled();
});

test('double submit verifies the password only once', async () => {
  let resolve!: (value: typeof verification) => void;
  vi.mocked(verifyAccountDeletion).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  mountPage();
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'member@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verifying…' }));
  expect(verifyAccountDeletion).toHaveBeenCalledTimes(1);
  resolve(verification);
  expect(await screen.findByLabelText('I understand that this action cannot be undone')).toBeInTheDocument();
});

test('saves the status receipt before requesting account deletion', async () => {
  vi.mocked(deleteAccount).mockImplementation(async () => {
    expect(loadAccountDeletionReceipt()).toEqual({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: verification.statusTokenExpiresAt });
    return pendingStatus;
  });
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));
  await screen.findByLabelText('I understand that this action cannot be undone');
  await user.click(screen.getByLabelText('I understand that this action cannot be undone'));
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));

  expect(deleteAccount).toHaveBeenCalledWith('deletion-secret');
  expect(setAccountDeletionPending).toHaveBeenCalledWith(true);
  expect(completeAccountDeletion).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Your account is closed/i)).toBeInTheDocument();
});

test('does not accept deletion twice while the first request is pending', async () => {
  let resolve!: (value: typeof pendingStatus) => void;
  vi.mocked(deleteAccount).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));
  await user.click(await screen.findByLabelText('I understand that this action cannot be undone'));
  const submit = screen.getByRole('button', { name: 'Delete my account' });
  act(() => { fireEvent.click(submit); fireEvent.click(submit); });

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  await act(async () => { resolve(pendingStatus); });
});

test('reload checks the receipt after a lost acceptance response', async () => {
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: '2026-10-15T20:00:00.000Z' });
  vi.mocked(getAccountDeletionStatus).mockResolvedValue(pendingStatus);

  mountPage();

  expect(await screen.findByText(/Your account is closed/i)).toBeInTheDocument();
  expect(getAccountDeletionStatus).toHaveBeenCalledWith('status-secret');
  expect(verifyAccountDeletion).not.toHaveBeenCalled();
});

test('keeps an expired status receipt and does not interpret 401 as completion', async () => {
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'expired-secret', expiresAt: '2026-10-15T20:00:00.000Z' });
  vi.mocked(getAccountDeletionStatus).mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'The status token has expired.'));

  mountPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('The deletion request may still be processing.');
  expect(loadAccountDeletionReceipt()?.statusToken).toBe('expired-secret');
  expect(completeAccountDeletion).not.toHaveBeenCalled();
});

test('does not claim an account is closed while receipt status is unknown', async () => {
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: '2026-10-15T20:00:00.000Z' });
  vi.mocked(getAccountDeletionStatus).mockRejectedValueOnce(new Error('network unavailable'));

  mountPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('We could not check the result yet.');
  expect(screen.queryByText(/Your account is closed/)).not.toBeInTheDocument();
});

test('keeps the public deletion screen open when browser cleanup fails', async () => {
  completeAccountDeletion.mockRejectedValueOnce(new Error('storage unavailable'));
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));
  await user.click(await screen.findByLabelText('I understand that this action cannot be undone'));
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not clear private data from this browser.');
  expect(screen.queryByRole('heading', { name: 'Private profile' })).not.toBeInTheDocument();
  expect(loadAccountDeletionReceipt()?.statusToken).toBe('status-secret');
});

test('retains the receipt when server completion precedes a failed browser cleanup', async () => {
  const completed = { ...pendingStatus, status: 'completed' as const, completedAt: '2026-10-13T20:30:00.000Z' };
  completeAccountDeletion.mockRejectedValueOnce(new Error('storage unavailable'));
  vi.mocked(getAccountDeletionStatus).mockResolvedValue(completed);
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));
  await user.click(await screen.findByLabelText('I understand that this action cannot be undone'));
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));

  expect(await screen.findByRole('button', { name: 'Retry browser cleanup' })).toBeInTheDocument();
  expect(loadAccountDeletionReceipt()?.statusToken).toBe('status-secret');
});

test('exposes the confirmation controls with keyboard-accessible labels', async () => {
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));

  await screen.findByLabelText('I understand that this action cannot be undone');
  expect(screen.getByRole('heading', { name: 'Delete your account' })).toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Delete your account' }));
  expect(screen.getByRole('checkbox')).toHaveAccessibleName('I understand that this action cannot be undone');
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('checkbox'));
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
});

test('does not promise draft deletion or backup deadlines', async () => {
  const user = userEvent.setup();
  mountPage();
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));

  expect(await screen.findByText(/Deletion of active data continues after this request is accepted/)).toBeInTheDocument();
  expect(screen.queryByText(/24 hours|30 days|35 days/)).not.toBeInTheDocument();
});

test('browser back after acceptance cannot restore a protected profile', async () => {
  function BackButton() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back</button>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/private', '/account-deletion']} initialIndex={1}><Routes>
    <Route path="/account-deletion" element={<><AccountDeletionPage /><BackButton /></>} />
    <Route element={<ProtectedRoute />}><Route path="/private" element={<h1>Private profile</h1>} /></Route>
    <Route path="/login" element={<h1>Sign in</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct');
  await user.click(screen.getByRole('button', { name: 'Verify password' }));
  await user.click(await screen.findByLabelText('I understand that this action cannot be undone'));
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  await screen.findByText(/Your account is closed/i);
  await user.click(screen.getByRole('button', { name: 'Back' }));

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Private profile' })).not.toBeInTheDocument();
});
