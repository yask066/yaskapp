import { Link, Outlet } from 'react-router-dom';
import { useSession } from '../app/session-provider';
import { Avatar } from './Avatar';
import { MaterialIcon } from './MaterialIcon';

export function AppLayout() {
  const { status, user, signOut } = useSession();
  const isAuthenticated = status === 'authenticated' && user;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" aria-label="Yaskapp" to="/"><img src="/branding/yaskapp_logo.png" alt="" /></Link>
        {isAuthenticated ? <div className="app-header-actions">
          <Link className="app-search" to="/search"><MaterialIcon name="search" /><span>Search polls, users or topics…</span></Link>
        </div> : null}
        {status === 'anonymous' ? <nav className="account-navigation" aria-label="Account navigation"><Link to="/login">Login</Link><Link className="create-poll-link" to="/register">Register</Link></nav> : null}
        {isAuthenticated ? (
          <nav className="account-navigation" aria-label="Account navigation">
            <Link className="notification-link" to="/search?view=notifications" aria-label="Notifications"><MaterialIcon name="notifications_none" /><i /></Link>
            <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={36} />
            <span className="account-name">{user.profile.displayName}<MaterialIcon name="chevron_down" /></span>
            <Link className="profile-link" to="/me">Profile</Link>
            <button className="sign-out-button" type="button" onClick={signOut}>Sign out</button>
          </nav>
        ) : null}
      </header>
      {isAuthenticated ? <aside className="app-sidebar">
        <nav aria-label="Primary navigation">
          <Link className="sidebar-link sidebar-link-active" to="/"><MaterialIcon name="home" /> Home</Link>
          <Link className="sidebar-link" to="/search"><MaterialIcon name="explore" /> Explore</Link>
          <Link className="sidebar-link" to="/search?view=notifications"><MaterialIcon name="notifications_none" /> Notifications <i /></Link>
          <Link className="sidebar-link" to="/me"><span aria-hidden="true"><Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={24} /></span> Profile</Link>
        </nav>
        <Link className="create-poll-link sidebar-create-poll" to="/polls/new"><MaterialIcon name="add" /> Create poll</Link>
      </aside> : null}
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
