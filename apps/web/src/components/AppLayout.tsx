import { Link, Outlet } from 'react-router-dom';
import { useSession } from '../app/session-provider';
import { Avatar } from './Avatar';

export function AppLayout() {
  const { status, user, signOut } = useSession();

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header>
        <a aria-label="Yaskapp" href="/">Yaskapp</a>
        {status === 'authenticated' ? <nav aria-label="Primary navigation">
            <Link to="/">Feed</Link>
            <Link to="/search">Search</Link>
            <Link to="/polls/new">Create poll</Link>
          </nav> : null}
        {status === 'anonymous' ? <nav aria-label="Account navigation"><Link to="/login">Login</Link><Link to="/register">Register</Link></nav> : null}
        {status === 'authenticated' && user ? (
          <nav aria-label="Account navigation">
            <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={28} />
            <Link to="/profile">Profile</Link>
            <button type="button" onClick={signOut}>Sign out</button>
          </nav>
        ) : null}
      </header>
      <Outlet />
    </>
  );
}
