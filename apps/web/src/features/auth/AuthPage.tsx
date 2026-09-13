import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useSession } from '../../app/session-provider';
import { MaterialIcon } from '../../components/MaterialIcon';

type AuthMode = 'login' | 'register';

interface AuthPageProps {
  mode: AuthMode;
}

function destination(search: string) {
  const next = new URLSearchParams(search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export function AuthPage({ mode }: AuthPageProps) {
  const { signIn, register } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
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
      await Promise.resolve(navigate(destination(location.search), { replace: true }));
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-showcase" aria-label="About Yask">
        <a className="auth-brand" href="/" aria-label="Yask home"><img src="/branding/yaskapp_logo.png" alt="" /></a>
        <div className="auth-showcase-copy">
          <h1>Share opinions.<br />Discover people.<br />See what the world thinks.</h1>
          <p>Polls, discussions and real people.<br />All in one place.</p>
        </div>
        <div className="showcase-note showcase-note-top">Discover topics <MaterialIcon name="arrow_down_right" /></div>
        <div className="showcase-note showcase-note-left">Create polls <MaterialIcon name="arrow_down_left" /></div>
        <div className="showcase-card showcase-card-poll" aria-hidden="true">
          <div className="showcase-author"><i>AK</i><span><b>alex.r</b><small>2h ago</small></span></div>
          <strong>Which team will win<br />the 2026 Formula 1 Championship?</strong>
          <div className="showcase-bars"><span>McLaren <i style={{ width: '76%' }} /></span><span>Ferrari <i style={{ width: '50%' }} /></span><span>Red Bull <i style={{ width: '34%' }} /></span></div>
          <footer><span><MaterialIcon name="people" /> 1.2K</span> <span><MaterialIcon name="favorite_border" /> 342</span></footer>
        </div>
        <div className="showcase-card showcase-card-topic" aria-hidden="true">
          <div className="showcase-author"><i>SO</i><span><b>sophia</b><small>5h ago</small></span></div>
          <strong>What's your favorite season?</strong>
          <p>Spring 🌱<br />Summer ☀️<br />Autumn 🍂<br />Winter ❄️</p>
          <footer><span><MaterialIcon name="people" /> 892</span> <span><MaterialIcon name="favorite_border" /> 421</span></footer>
        </div>
        <div className="showcase-card showcase-card-code" aria-hidden="true">
          <div className="showcase-author"><i>MD</i><span><b>max_dev</b><small>1d ago</small></span></div>
          <strong>Which programming language<br />do you use most?</strong>
          <div className="showcase-bars"><span>Kotlin <i style={{ width: '70%' }} /></span><span>Python <i style={{ width: '43%' }} /></span><span>JavaScript <i style={{ width: '25%' }} /></span></div>
          <footer><span><MaterialIcon name="people" /> 3.6K</span> <span><MaterialIcon name="favorite_border" /> 520</span></footer>
        </div>
        <p className="auth-showcase-tagline">REAL OPINIONS.<br />REAL PEOPLE.<br />A MORE OPEN WORLD.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-top-prompt">{isRegistration ? 'Already have an account?' : 'Don’t have an account?'} <a href={isRegistration ? '/login' : '/register'}>{isRegistration ? 'Log in' : 'Sign up'}</a></div>
        <div className="auth-form-card">
          <header>
            <h2>{isRegistration ? 'Create your account' : 'Welcome back'}</h2>
            <p>{isRegistration ? 'Join the Yask community' : 'Log in to your Yask account'}</p>
          </header>
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
        <p id="password-description" className="sr-only">Use a password you do not reuse elsewhere.</p>
        <div className="password-input-wrap">
          <input id="password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={isRegistration ? 'new-password' : 'current-password'} required aria-describedby="password-description" placeholder="Enter your password" />
          <button className="password-visibility" type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((visible) => !visible)}><MaterialIcon name={passwordVisible ? 'visibility_off' : 'visibility'} /></button>
        </div>
        {isRegistration ? <>
          <label htmlFor="countryCode">Country code</label>
          <p id="country-code-description">Use your two-letter country code.</p>
          <input id="countryCode" name="countryCode" autoComplete="country" required aria-describedby="country-code-description" />
          <label htmlFor="displayName">Display name (optional)</label>
          <p id="display-name-description">This is the name shown on your polls.</p>
          <input id="displayName" name="displayName" autoComplete="name" aria-describedby="display-name-description" />
        </> : null}
        {serverError ? <p className="auth-server-error" role="alert">{serverError}</p> : null}
        {!isRegistration ? <a className="forgot-password-link" href="#forgot-password">Forgot password?</a> : null}
        <button className="auth-submit" type="submit" disabled={pending}>{pending ? 'Submitting…' : isRegistration ? 'Create account' : 'Sign in'}</button>
          </form>
          {!isRegistration ? <>
            <div className="auth-divider"><span>or continue with</span></div>
            <div className="social-buttons" aria-label="Social sign-in options">
              <button type="button" disabled title="Social sign-in is not available yet"><b className="google-mark">G</b>Google</button>
              <button type="button" disabled><b>◉</b>GitHub</button>
              <button type="button" disabled><b className="discord-mark">◉</b>Discord</button>
            </div>
          </> : null}
          <p className="auth-bottom-prompt">{isRegistration ? 'Already have an account?' : 'Don’t have an account?'} <a href={isRegistration ? '/login' : '/register'}>{isRegistration ? 'Log in' : 'Sign up'}</a></p>
        </div>
        <footer className="auth-legal"><span>Terms</span><span>Privacy</span><span>Help</span><span>© 2026 Yask. All rights reserved.</span></footer>
      </section>
    </main>
  );
}
