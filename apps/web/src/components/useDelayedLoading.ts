import { useEffect, useState } from 'react';

export function useDelayedLoading(loading: boolean, delayMs = 150) {
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!loading) {
      setDelayElapsed(false);
      return;
    }

    const timeout = window.setTimeout(() => setDelayElapsed(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, loading]);

  return loading && delayElapsed;
}
