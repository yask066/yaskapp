import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useSession } from '../../app/session-provider';

type AuthMode = 'login' | 'register';

interface AuthPageProps {
  mode: AuthMode;
}

function destination(search: string) {
  const next = new URLSearchParams(search).get('next');
  return next?.startsWith('/') ? next : '/';
}

export function AuthPage({ mode }: AuthPageProps) {
  const { signIn, register } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isRegistration = mode === 'register';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setServerError(null);
    try {
      if (isRegistration) {
        await register({
          email: String(formData.get('email') ?? ''),
          username: String(formData.get('username') ?? ''),
          password: String(formData.get('password') ?? ''),
          countryCode: String(formData.get('countryCode') ?? ''),
          displayName: String(formData.get('displayName') ?? '') || undefined,
        });
      } else {
        await signIn({ login: String(formData.get('login') ?? ''), password: String(formData.get('password') ?? '') });
      }
      navigate(destination(location.search), { replace: true });
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content">
      <h1>{isRegistration ? 'Create your account' : 'Sign in'}</h1>
      <form onSubmit={handleSubmit}>
        {isRegistration ? <>
          <label htmlFor="email">Email</label>
          <p id="email-description">We’ll use this to help secure your account.</p>
          <input id="email" name="email" type="email" autoComplete="email" required aria-describedby="email-description" />
          <label htmlFor="username">Username</label>
          <p id="username-description">Choose the name people will use to find you.</p>
          <input id="username" name="username" autoComplete="username" required aria-describedby="username-description" />
        </> : <>
          <label htmlFor="login">Login</label>
          <p id="login-description">Enter your email address or username.</p>
          <input id="login" name="login" autoComplete="username" required aria-describedby="login-description" />
        </>}
        <label htmlFor="password">Password</label>
        <p id="password-description">Use a password you do not reuse elsewhere.</p>
        <input id="password" name="password" type="password" autoComplete={isRegistration ? 'new-password' : 'current-password'} required aria-describedby="password-description" />
        {isRegistration ? <>
          <label htmlFor="countryCode">Country code</label>
          <p id="country-code-description">Use your two-letter country code.</p>
          <input id="countryCode" name="countryCode" autoComplete="country" required aria-describedby="country-code-description" />
          <label htmlFor="displayName">Display name (optional)</label>
          <p id="display-name-description">This is the name shown on your polls.</p>
          <input id="displayName" name="displayName" autoComplete="name" aria-describedby="display-name-description" />
        </> : null}
        {serverError ? <p role="alert">{serverError}</p> : null}
        <button type="submit" disabled={pending}>{pending ? 'Submitting…' : isRegistration ? 'Register' : 'Sign in'}</button>
      </form>
    </main>
  );
}
