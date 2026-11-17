import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../app/session-provider';
import { Avatar } from './Avatar';
import { MaterialIcon } from './MaterialIcon';
import { ThemeToggle } from './ThemeToggle';
import { useOptionalNotificationUnreadCount } from '../features/notifications/notification-store';

export function AppLayout() {
  const { status, user, signOut } = useSession();
  const isAuthenticated = status === 'authenticated' && user;
  const unreadCount = useOptionalNotificationUnreadCount();
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const notificationLabel = unreadCount > 0 ? `Notifications, ${unreadLabel} unread` : 'Notifications';
  const navigationClassName = ({ isActive }: { isActive: boolean }) =>
    `nav-link sidebar-link${isActive ? ' nav-link--active sidebar-link-active' : ''}`;

  const [menuOpen, setMenuOpen] = useState(false);
  const [headerQuery, setHeaderQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isSearchPage = pathname === '/search';

  const handleHeaderSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = headerQuery.trim();
    if (trimmed.length >= 2) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      setHeaderQuery('');
    } else {
      navigate('/search');
    }
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden="true">
        <span className="ambient-glow__orb ambient-glow__orb--orange" />
        <span className="ambient-glow__orb ambient-glow__orb--indigo" />
        <span className="ambient-glow__orb ambient-glow__orb--deep" />
      </div>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" aria-label="Yaskapp" to="/"><img src="/branding/yaskapp_logo.png" alt="" /></Link>
        {isAuthenticated && !isSearchPage ? <div className="app-header-actions">
          <form className="app-search" role="search" aria-label="Quick search" onSubmit={handleHeaderSearch}>
            <MaterialIcon name="search" />
            <input
              className="app-search__input"
              type="search"
              value={headerQuery}
              onChange={(event) => setHeaderQuery(event.target.value)}
              placeholder="Search polls, users or topics…"
              aria-label="Search polls, users or topics"
            />
          </form>
        </div> : null}
        <ThemeToggle />
        {status === 'anonymous' ? <nav className="account-navigation" aria-label="Account navigation"><Link to="/login">Login</Link><Link className="create-poll-link" to="/register">Register</Link></nav> : null}
        {isAuthenticated ? (
          <nav className="account-navigation" aria-label="Account navigation">
            <Link className="notification-link" to="/notifications" aria-label={notificationLabel}><MaterialIcon name="notifications_none" />{unreadCount > 0 ? <span className="notification-badge">{unreadLabel}</span> : null}</Link>
            <div className="account-menu" ref={menuRef}>
              <button
                ref={triggerRef}
                type="button"
                className="account-menu-trigger"
                aria-expanded={menuOpen}
                aria-controls="account-menu-dropdown"
                aria-label={`Account menu for ${user.profile.displayName}`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={34} />
                <span className="account-name">{user.profile.displayName}</span>
                <MaterialIcon name="chevron_down" className="account-menu-chevron" />
              </button>
              {menuOpen ? (
                <div id="account-menu-dropdown" className="account-menu-dropdown">
                  <div className="account-menu-header">
                    <strong>{user.profile.displayName}</strong>
                    <span>@{user.username}</span>
                  </div>
                  <Link className="account-menu-item profile-link" to="/me" onClick={() => setMenuOpen(false)}>Profile</Link>
                  <button
                    className="account-menu-item account-menu-item--danger sign-out-button"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </nav>
        ) : null}
      </header>
      {isAuthenticated ? <aside className="app-sidebar">
        <nav className="app-sidebar-navigation" aria-label="Primary navigation">
          <NavLink end className={navigationClassName} to="/"><MaterialIcon name="home" /> Home</NavLink>
          <NavLink className={navigationClassName} to="/search"><MaterialIcon name="explore" /> Explore</NavLink>
          <NavLink className={navigationClassName} to="/notifications" aria-label={notificationLabel}><MaterialIcon name="notifications_none" /> Notifications{unreadCount > 0 ? <span className="notification-badge">{unreadLabel}</span> : null}</NavLink>
          <NavLink className={navigationClassName} to="/me"><span aria-hidden="true"><Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={24} /></span> Profile</NavLink>
        </nav>
        <Link className="create-poll-link sidebar-create-poll" to="/polls/new"><MaterialIcon name="add" /> Create poll</Link>
      </aside> : null}
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
