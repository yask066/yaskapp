import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { deleteAccount, getAccountDeletionStatus, verifyAccountDeletion } from '../../api/account-deletion';
import type { AccountDeletionStatusResponse, AccountDeletionVerificationResponse } from '@yaskapp/shared';
import { useOptionalSession } from '../../app/session-provider';
import { announceAccountDeletion } from './account-deletion-tabs';
import { clearAccountDeletionReceipt, loadAccountDeletionReceipt, saveAccountDeletionReceipt, type AccountDeletionReceipt } from './account-deletion-receipt';

const DELETION_DETAILS = [
  'Your account, profile, avatar, polls, comments, votes, likes, follows, and notification settings will be deleted.',
  'Discussions and activity in polls you created will also be deleted.',
  'Access closes immediately. Deletion of active data continues after this request is accepted.',
  'This action cannot be undone. Your account and content cannot be restored.',
  'A private moderation archive of account identifiers, recent IP addresses and violation records is retained for 30 days. Issued IP bans may remain after that.',
];

type Verification = Pick<AccountDeletionVerificationResponse, 'operationId' | 'deletionToken' | 'statusToken' | 'statusTokenExpiresAt'>;

function statusText(status: AccountDeletionStatusResponse['status']): string {
  if (status === 'completed') return 'All active data stores have finished deletion.';
  return 'Your account is closed. Data deletion is in progress.';
}

export function AccountDeletionPage() {
  const session = useOptionalSession();
  const completeAccountDeletion = session?.completeAccountDeletion;
  const setAccountDeletionPending = session?.setAccountDeletionPending;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [receipt, setReceipt] = useState<AccountDeletionReceipt | null>(() => loadAccountDeletionReceipt());
  const [receiptExpired, setReceiptExpired] = useState(Boolean(session?.accountDeletionReceiptExpired));
  const [lockedReceiptToken, setLockedReceiptToken] = useState<string | null>(null);
  const receiptLockReady = !receipt || lockedReceiptToken === receipt.statusToken;
  const [statusResult, setStatusResult] = useState<AccountDeletionStatusResponse | null>(null);
  const [checking, setChecking] = useState(Boolean(receipt));
  const [verification, setVerification] = useState<Verification | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(searchParams.get('cleanup') === 'failed');
  const acceptedWithoutReceipt = !receipt && searchParams.get('status') === 'accepted';
  const cleanupApplied = useRef(false);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => { headingRef.current?.focus(); }, [receipt, verification]);

  useEffect(() => {
    if (!receipt || lockedReceiptToken === receipt.statusToken) return undefined;
    let alive = true;
    void Promise.resolve(setAccountDeletionPending?.(true)).then(() => {
      if (alive) setLockedReceiptToken(receipt.statusToken);
    }).catch(() => {
      if (alive) {
        setCleanupFailed(true);
        setError('Could not clear private data from this browser. Retry browser cleanup before checking the deletion result.');
      }
    });
    return () => { alive = false; };
  }, [lockedReceiptToken, receipt, setAccountDeletionPending]);

  useEffect(() => {
    if (!session?.accountDeletionReceiptExpired || receipt) return;
    let alive = true;
    setReceiptExpired(true);
    void (async () => {
      try {
        await completeAccountDeletion?.();
        await setAccountDeletionPending?.(false);
        if (alive) setError('The status receipt expired. This browser has been cleared, but the server deletion result could not be confirmed here.');
      } catch {
        if (alive) {
          setCleanupFailed(true);
          setError('The status receipt expired and private browser cleanup could not finish. Retry cleanup before continuing.');
        }
      }
    })();
    return () => { alive = false; };
  }, [completeAccountDeletion, receipt, session?.accountDeletionReceiptExpired, setAccountDeletionPending]);

  useEffect(() => {
    if (!acceptedWithoutReceipt) return;
    if (cleanupFailed) return;
    void setAccountDeletionPending?.(false);
  }, [acceptedWithoutReceipt, cleanupFailed, setAccountDeletionPending]);

  useEffect(() => {
    if (!receipt || !receiptLockReady) return undefined;
    let alive = true;
    let delay = 2_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (!alive) return;
      setChecking(true);
      try {
        const next = await getAccountDeletionStatus(receipt.statusToken);
        if (!alive) return;
        setStatusResult(next);
        if (!cleanupFailed) setError(null);
        if (next.status === 'completed') {
          if (pending || cleanupFailed) {
            setChecking(false);
            return;
          }
          try {
            await completeAccountDeletion?.();
            cleanupApplied.current = true;
            await setAccountDeletionPending?.(false);
          } catch {
            setCleanupFailed(true);
            setError('Could not clear private data from this browser. Your account deletion is complete; retry browser cleanup before continuing.');
            setChecking(false);
            return;
          }
          clearAccountDeletionReceipt();
          setReceipt(null);
          return;
        }
        if (next.status === 'not_started' && inFlight.current) {
          timer = setTimeout(() => { void check(); }, delay);
          delay = Math.min(30_000, delay * 2);
          return;
        }
        if (next.status === 'not_started') {
          await setAccountDeletionPending?.(false);
          setError('The deletion request was not accepted. Verify your password again to restart.');
          setChecking(false);
          return;
        }
        if (!cleanupApplied.current) {
          try {
            await completeAccountDeletion?.();
            cleanupApplied.current = true;
            announceAccountDeletion();
          } catch {
            setCleanupFailed(true);
            setError('Could not clear private data from this browser. Your account is closed; retry browser cleanup before continuing.');
            setChecking(false);
            return;
          }
        }
        timer = setTimeout(() => { void check(); }, delay);
        delay = Math.min(30_000, delay * 2);
        return;
      } catch (reason) {
        if (!alive) return;
        if (reason instanceof ApiError && reason.status === 401) {
          clearAccountDeletionReceipt();
          setReceipt(null);
          setReceiptExpired(true);
          try {
            await completeAccountDeletion?.();
            cleanupApplied.current = true;
            await setAccountDeletionPending?.(false);
            setError('The status receipt expired. This browser has been cleared, but the server deletion result could not be confirmed here.');
          } catch {
            setCleanupFailed(true);
            setError('The status receipt expired and private browser cleanup could not finish. Retry cleanup before continuing.');
          }
          return;
        }
        setError('We could not check the result yet. Your receipt is saved and you can try again.');
        timer = setTimeout(() => { void check(); }, delay);
        delay = Math.min(30_000, delay * 2);
      } finally {
        if (alive) setChecking(false);
      }
    };
    void check();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [cleanupFailed, completeAccountDeletion, pending, receipt, receiptLockReady, setAccountDeletionPending]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await verifyAccountDeletion({
        ...(session?.status === 'authenticated' ? {} : { login: login.trim() }),
        password,
      });
      setVerification({ operationId: result.operationId, deletionToken: result.deletionToken, statusToken: result.statusToken, statusTokenExpiresAt: result.statusTokenExpiresAt });
      setPassword('');
      setUnderstood(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify your password.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function finishAccepted(status: AccountDeletionStatusResponse, saved: AccountDeletionReceipt) {
    setStatusResult(status);
    setReceipt(saved);
    setChecking(false);
    try {
      await completeAccountDeletion?.();
      cleanupApplied.current = true;
      announceAccountDeletion();
      setCleanupFailed(false);
      await Promise.resolve(navigate('/account-deletion?status=accepted', { replace: true }));
    } catch {
      setCleanupFailed(true);
      setError('Could not clear private data from this browser. Your account is closed; retry browser cleanup before continuing.');
    }
  }

  async function acceptDeletion() {
    if (!verification || !understood || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const saved = {
      operationId: verification.operationId,
      statusToken: verification.statusToken,
      expiresAt: verification.statusTokenExpiresAt,
    };
    try {
      saveAccountDeletionReceipt(saved);
      setReceipt(saved);
      await setAccountDeletionPending?.(true);
      try {
        const result = await deleteAccount(verification.deletionToken);
        await finishAccepted(result, saved);
      } catch (requestError) {
        try {
          const current = await getAccountDeletionStatus(verification.statusToken);
          if (current.status === 'not_started') {
            setStatusResult(current);
            setError(requestError instanceof Error ? requestError.message : 'The deletion request was not accepted. Please try again.');
          } else {
            await finishAccepted(current, saved);
          }
        } catch {
          setChecking(true);
          setError('We are checking whether your request was accepted. Your receipt is saved.');
        }
      }
    } catch {
      setError('Could not save a status receipt in this browser. The deletion request was not sent.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function retryCleanup() {
    setPending(true);
    setError(null);
    try {
      await completeAccountDeletion?.();
      cleanupApplied.current = true;
      announceAccountDeletion();
      setCleanupFailed(false);
      if (receipt && statusResult?.status === 'completed') {
        clearAccountDeletionReceipt();
        setReceipt(null);
        await setAccountDeletionPending?.(false);
      } else if (!receipt) {
        await setAccountDeletionPending?.(false);
      }
      if (acceptedWithoutReceipt) await Promise.resolve(navigate('/account-deletion?status=accepted', { replace: true }));
    } catch {
      setError('Could not clear private data from this browser. Try again after closing other tabs.');
    } finally {
      setPending(false);
    }
  }

  function restartVerification() {
    clearAccountDeletionReceipt();
    void setAccountDeletionPending?.(false);
    setReceipt(null);
    setReceiptExpired(false);
    setStatusResult(null);
    setVerification(null);
    setUnderstood(false);
    setLogin('');
    setPassword('');
    setPending(false);
    setCleanupFailed(false);
    setError(null);
  }

  if (session?.status === 'loading' && !receipt) {
    return <main id="main-content"><p role="status">Loading your session…</p></main>;
  }

  if (cleanupFailed) {
    return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="status">{receiptExpired ? 'The status receipt expired.' : statusText(statusResult?.status ?? 'pending')}</p>{error ? <p role="alert">{error}</p> : null}<button className="button button--primary" disabled={pending} onClick={() => void retryCleanup()}>{pending ? 'Securing browser…' : 'Retry browser cleanup'}</button></main>;
  }

  if (receipt) {
    if (statusResult?.status === 'not_started') {
      return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="alert">{error}</p><button className="button" onClick={restartVerification}>Verify again</button></main>;
    }
    return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="status" aria-live="polite">{checking ? 'Checking the result of your request…' : statusResult ? statusText(statusResult.status) : 'Checking whether the server accepted your request. Your receipt is saved.'}</p>{error && !checking ? <p role="alert">{error}</p> : null}{statusResult?.status === 'completed' ? <p>{statusText('completed')}</p> : null}</main>;
  }

  if (acceptedWithoutReceipt) {
    return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="status">Your account access was closed on another device. This browser has no status receipt, so it cannot show the deletion progress.</p></main>;
  }

  if (receiptExpired) {
    return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="status">The status receipt expired. This browser has been cleared, but the server deletion result could not be confirmed here.</p>{error ? <p role="alert">{error}</p> : null}<button className="button" onClick={restartVerification}>Verify again</button></main>;
  }

  if (statusResult?.status === 'completed') {
    return <main id="main-content" className="profile-page"><h1 ref={headingRef} tabIndex={-1}>Account deletion</h1><p role="status">{statusText('completed')}</p></main>;
  }

  return <main id="main-content" className="profile-page account-deletion-page">
    <h1 ref={headingRef} tabIndex={-1}>Delete your account</h1>
    {verification ? <>
      <section aria-label="What will happen"><ul>{DELETION_DETAILS.map((detail) => <li key={detail}>{detail}</li>)}</ul></section>
      <label className="field"><span><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.currentTarget.checked)} /> I understand that this action cannot be undone</span></label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="button button--primary" type="button" disabled={!understood || pending} onClick={() => void acceptDeletion()}>{pending ? 'Deleting…' : 'Delete my account'}</button>
      <button className="button" type="button" disabled={pending} onClick={() => setVerification(null)}>Cancel</button>
    </> : <>
      <p>Confirm your password to continue. Your account will be closed immediately when deletion is accepted.</p>
      <form className="form-panel" aria-label="Verify account deletion" onSubmit={(event) => void verify(event)}>
        {session?.status !== 'authenticated' ? <label className="field">Login<input autoComplete="username" required value={login} onChange={(event) => setLogin(event.currentTarget.value)} /></label> : null}
        <label className="field">Password<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        {error ? <p role="alert">{error}</p> : null}
        <button className="button button--primary" type="submit" disabled={pending}>{pending ? 'Verifying…' : 'Verify password'}</button>
      </form>
    </>}
  </main>;
}
