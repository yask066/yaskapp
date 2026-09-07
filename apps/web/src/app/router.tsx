import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { AuthPage } from '../features/auth/AuthPage';
import { FeedPage } from '../features/feed/FeedPage';
import { CreatePollPage } from '../features/polls/CreatePollPage';
import { PollDetailPage } from '../features/comments/PollDetailPage';
import { MyProfilePage } from '../features/profiles/MyProfilePage';
import { PublicProfilePage } from '../features/profiles/PublicProfilePage';
import { SearchPage } from '../features/search/SearchPage';
import { useSession } from './session-provider';

function LoadingMain() {
  return <main id="main-content"><p role="status">Loading your session…</p></main>;
}

export function PublicOnlyRoute() {
  const { status } = useSession();
  if (status === 'loading') return <LoadingMain />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

export function ProtectedRoute() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <LoadingMain />;
  if (status === 'anonymous') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <Outlet />;
}

// The router is intentionally shared with the application bootstrap.
// eslint-disable-next-line react-refresh/only-export-components
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <FeedPage /> },
      { path: 'polls/:pollId', element: <PollDetailPage /> },
      { path: 'users/:userId', element: <PublicProfilePage /> },
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: 'login', element: <AuthPage mode="login" /> },
          { path: 'register', element: <AuthPage mode="register" /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'search', element: <SearchPage /> },
          { path: 'polls/new', element: <CreatePollPage /> },
          { path: 'me', element: <MyProfilePage /> },
        ],
      },
    ],
  },
]);
