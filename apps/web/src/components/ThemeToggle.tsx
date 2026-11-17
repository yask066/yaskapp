import { useEffect, useState, type JSX, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(DARK_QUERY).matches;
}

function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function syncColorSchemeMeta(mode: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', mode === 'system' ? 'light dark' : mode);
}

function resolveEffectiveTheme(mode: ThemeMode, systemPrefersDark: boolean): EffectiveTheme {
  if (mode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return mode;
}

function persistMode(mode: ThemeMode): void {
  try {
    if (mode === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage access errors in restricted browsing modes.
  }
}

export function ThemeToggle(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());

  const effectiveTheme = resolveEffectiveTheme(mode, systemPrefersDark);
  const systemThemeLabel = systemPrefersDark ? 'dark' : 'light';

  useEffect(() => {
    syncColorSchemeMeta(mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
      return () => mediaQuery.removeEventListener('change', handleMediaChange);
    }
    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) {
        return;
      }
      const updated = readStoredMode();
      setMode(updated);
      syncColorSchemeMeta(updated);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const selectMode = (nextMode: ThemeMode, event: MouseEvent<HTMLButtonElement>) => {
    if (nextMode === mode) {
      return;
    }

    const nextEffective = resolveEffectiveTheme(nextMode, systemPrefersDark);
    const shouldAnimate =
      nextEffective !== effectiveTheme &&
      typeof document.startViewTransition === 'function' &&
      !getPrefersReducedMotion();

    const applyUpdate = () => {
      persistMode(nextMode);
      syncColorSchemeMeta(nextMode);
      flushSync(() => {
        setMode(nextMode);
      });
    };

    if (!shouldAnimate) {
      applyUpdate();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--vt-x', `${x}px`);
    rootStyle.setProperty('--vt-y', `${y}px`);
    rootStyle.setProperty('--vt-r', `${radius}px`);

    const transition = document.startViewTransition(() => {
      applyUpdate();
    });
    void transition.finished.finally(() => {
      rootStyle.removeProperty('--vt-x');
      rootStyle.removeProperty('--vt-y');
      rootStyle.removeProperty('--vt-r');
    });
  };

  return (
    <div className="theme-toggle-group" role="group" aria-label="Color theme">
      <button
        type="button"
        className={`theme-toggle-option${mode === 'light' ? ' is-active' : ''}`}
        aria-pressed={mode === 'light'}
        onClick={(event) => selectMode('light', event)}
      >
        <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        <span className="theme-toggle__label">Light</span>
      </button>

      <button
        type="button"
        className={`theme-toggle-option${mode === 'dark' ? ' is-active' : ''}`}
        aria-pressed={mode === 'dark'}
        onClick={(event) => selectMode('dark', event)}
      >
        <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" fill="currentColor" />
        </svg>
        <span className="theme-toggle__label">Dark</span>
      </button>

      <button
        type="button"
        className={`theme-toggle-option${mode === 'system' ? ' is-active' : ''}`}
        aria-pressed={mode === 'system'}
        aria-label={`System (currently ${systemThemeLabel})`}
        title={`System (currently ${systemThemeLabel})`}
        onClick={(event) => selectMode('system', event)}
      >
        <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="theme-toggle__label">System</span>
      </button>
    </div>
  );
}
