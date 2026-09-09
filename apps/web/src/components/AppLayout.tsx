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
        </div> : null}
        {status === 'anonymous' ? <nav className="account-navigation" aria-label="Account navigation"><Link to="/login">Login</Link><Link className="create-poll-link" to="/register">Register</Link></nav> : null}
        {isAuthenticated ? (
          <nav className="account-navigation" aria-label="Account navigation">
            <Link className="notification-link" to="/search?view=notifications" aria-label="Notifications"><span aria-hidden="true">♧</span><i /></Link>
            <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={36} />
            <span className="account-name">{user.profile.displayName}</span>
            <Link className="profile-link" to="/me">Profile</Link>
            <button className="sign-out-button" type="button" onClick={signOut}>Sign out</button>
          </nav>
        ) : null}
      </header>
      {isAuthenticated ? <aside className="app-sidebar">
        <nav aria-label="Primary navigation">
          <Link className="sidebar-link sidebar-link-active" to="/"><span aria-hidden="true">⌂</span> Home</Link>
          <Link className="sidebar-link" to="/search"><span aria-hidden="true">⌕</span> Explore</Link>
          <Link className="sidebar-link" to="/search?view=notifications"><span aria-hidden="true">♧</span> Notifications <i /></Link>
          <Link className="sidebar-link" to="/me"><span aria-hidden="true">♙</span> Profile</Link>
        </nav>
        <Link className="create-poll-link sidebar-create-poll" to="/polls/new"><span aria-hidden="true">＋</span> Create poll</Link>
        <p className="sidebar-footer"><span>About</span><span>Help</span><span>Terms</span><span>Privacy</span><span>© 2026 Yask</span></p>
      </aside> : null}
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
