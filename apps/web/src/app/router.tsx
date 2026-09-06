import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { AuthPage } from '../features/auth/AuthPage';
import { FeedPage } from '../features/feed/FeedPage';
import { CreatePollPage } from '../features/polls/CreatePollPage';
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

function ProtectedPlaceholder({ title }: { title: string }) {
  return <main id="main-content"><h1>{title}</h1></main>;
}

// The router is intentionally shared with the application bootstrap.
// eslint-disable-next-line react-refresh/only-export-components
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <FeedPage /> },
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
          { path: 'search', element: <ProtectedPlaceholder title="Search" /> },
          { path: 'polls/new', element: <CreatePollPage /> },
          { path: 'profile', element: <ProtectedPlaceholder title="Profile" /> },
        ],
      },
    ],
  },
]);
