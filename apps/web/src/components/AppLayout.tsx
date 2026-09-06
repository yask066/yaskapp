import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../app/session-provider';
import { Avatar } from './Avatar';

export function AppLayout() {
  const { status, user, signOut } = useSession();
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  function handleSignOut() {
    signOut();
    setAccountMenuOpen(false);
    navigate('/');
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header>
        <a aria-label="Yaskapp" href="/">Yaskapp</a>
        <nav aria-label="Primary navigation">
          {status === 'authenticated' ? <>
            <Link to="/">Feed</Link>
            <Link to="/search">Search</Link>
            <Link to="/polls/new">Create poll</Link>
          </> : null}
        </nav>
        {status === 'anonymous' ? <nav aria-label="Account navigation"><Link to="/login">Login</Link><Link to="/register">Register</Link></nav> : null}
        {status === 'authenticated' && user ? (
          <div>
            <button type="button" aria-expanded={accountMenuOpen} aria-haspopup="menu" onClick={() => setAccountMenuOpen((open) => !open)}>
              <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={28} />
              Account
            </button>
            {accountMenuOpen ? <div role="menu" aria-label="Account menu">
              <Link role="menuitem" to="/profile" onClick={() => setAccountMenuOpen(false)}>Profile</Link>
              <button role="menuitem" type="button" onClick={handleSignOut}>Sign out</button>
            </div> : null}
          </div>
        ) : null}
      </header>
      <Outlet />
    </>
  );
}
