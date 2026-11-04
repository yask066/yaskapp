import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { transferableAbortController } from 'node:util';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactElement, type ReactNode } from 'react';

vi.stubEnv('VITE_FEED_PAGINATION', 'true');

// Node fetch/Request (and MSW) require signals from their own realm.
const nodeController = transferableAbortController();
globalThis.AbortController = nodeController.constructor as typeof AbortController;
globalThis.AbortSignal = nodeController.signal.constructor as typeof AbortSignal;

// Node 22+ introduces experimental globalThis.localStorage which evaluates to undefined
// unless --localstorage-file is provided, shadowing JSDOM's window.localStorage.
function createMockStorage(): Storage {
  const store = new Map<string, string>();
  const target = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(String(key)) ?? null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(String(key)); },
    setItem(key: string, value: string) { store.set(String(key), String(value)); },
  } as unknown as Storage;

  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'string' && !(prop in t)) return store.get(prop);
      return Reflect.get(t, prop, receiver);
    },
    set(t, prop, value, receiver) {
      if (typeof prop === 'string' && !(prop in t)) { store.set(prop, String(value)); return true; }
      return Reflect.set(t, prop, value, receiver);
    },
    deleteProperty(t, prop) {
      if (typeof prop === 'string') return store.delete(prop);
      return Reflect.deleteProperty(t, prop);
    },
    ownKeys() { return Array.from(store.keys()); },
    getOwnPropertyDescriptor(t, prop) {
      if (typeof prop === 'string' && store.has(prop)) {
        return { value: store.get(prop), writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(t, prop);
    },
  });
}

// In Node 22+, globalThis has an unconfigured experimental localStorage getter returning undefined,
// which breaks JSDOM and browser tests when --localstorage-file is not provided.
const mockLocalStorage = createMockStorage();
const mockSessionStorage = createMockStorage();
delete (globalThis as Record<string, unknown>).localStorage;
delete (globalThis as Record<string, unknown>).sessionStorage;
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: mockSessionStorage, writable: true, configurable: true });
if (typeof window !== 'undefined') {
  delete (window as unknown as Record<string, unknown>).localStorage;
  delete (window as unknown as Record<string, unknown>).sessionStorage;
  Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: mockSessionStorage, writable: true, configurable: true });
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function TestProviders({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children),
    );
  }

  return render(ui, { wrapper: TestProviders, ...options });
}
