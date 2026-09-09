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
          <Link className="sidebar-link sidebar-link-active" to="/"><span aria-hidden="true">⌂</span> Feed</Link>
          <Link className="sidebar-link" to="/search"><span aria-hidden="true">⌕</span> Explore</Link>
          <Link className="sidebar-link" to="/search?view=notifications"><span aria-hidden="true">♧</span> Notifications <i /></Link>
          <Link className="sidebar-link" to="/me"><span aria-hidden="true">♙</span> Profile</Link>
        </nav>
        <nav className="topic-navigation" aria-label="Popular topics"><strong>Popular topics</strong>{['Formula1', 'Football', 'Gaming', 'Technology', 'Movies'].map((topic) => <Link key={topic} to={`/?topic=${topic}`}><span aria-hidden="true">#</span>{topic}</Link>)}<Link className="show-more" to="/search">Show more <span aria-hidden="true">›</span></Link></nav>
        <section className="sidebar-cta"><h2>Share your opinion<br />Shape the world</h2><Link className="create-poll-link" to="/polls/new"><span aria-hidden="true">＋</span> Create poll</Link></section>
        <p className="sidebar-footer"><strong>Yask</strong><span>Polls bring people closer.</span></p>
      </aside> : null}
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
