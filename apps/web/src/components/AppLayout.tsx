import { Link, Outlet } from 'react-router-dom';
import { useSession } from '../app/session-provider';
import { Avatar } from './Avatar';

export function AppLayout() {
  const { status, user, signOut } = useSession();
  const isAuthenticated = status === 'authenticated' && user;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" aria-label="Yaskapp" to="/"><span>Y</span>ask</Link>
        {isAuthenticated ? <div className="app-header-actions">
          <Link className="app-search" to="/search"><span aria-hidden="true">⌕</span><span>Search polls, users or topics…</span></Link>
          <Link className="create-poll-link" to="/polls/new"><span aria-hidden="true">＋</span> Create poll</Link>
        </div> : null}
        {status === 'anonymous' ? <nav className="account-navigation" aria-label="Account navigation"><Link to="/login">Login</Link><Link className="create-poll-link" to="/register">Register</Link></nav> : null}
        {isAuthenticated ? (
          <nav className="account-navigation" aria-label="Account navigation">
            <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={36} />
            <span className="account-name">{user.profile.displayName}</span>
            <Link className="profile-link" to="/me">Profile</Link>
            <button className="sign-out-button" type="button" onClick={signOut}>Sign out</button>
          </nav>
        ) : null}
      </header>
      {isAuthenticated ? <aside className="app-sidebar">
        <nav aria-label="Primary navigation">
          <Link className="sidebar-link sidebar-link-active" to="/"><span aria-hidden="true">⌂</span> Feed</Link>
          <Link className="sidebar-link" to="/search"><span aria-hidden="true">⌕</span> Explore</Link>
          <Link className="sidebar-link" to="/me"><span aria-hidden="true">♙</span> Profile</Link>
        </nav>
        <p className="sidebar-footer">© 2026 Yask</p>
      </aside> : null}
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
