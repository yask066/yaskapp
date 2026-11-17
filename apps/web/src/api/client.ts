const FIELD_LABELS: Record<string, string> = {
  login: 'Login',
  email: 'Email',
  username: 'Username',
  password: 'Password',
  countryCode: 'Country code',
  displayName: 'Display name',
  bio: 'Bio',
  question: 'Question',
  options: 'Options',
  body: 'Comment',
};

export type ValidationDetails = Record<string, string[]>;

function parseValidationDetails(raw: unknown): ValidationDetails | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const parsed: ValidationDetails = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      const messages = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (messages.length > 0) parsed[key] = messages;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function formatFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}

export function formatApiErrorMessage(
  status: number,
  code: string | undefined,
  serverMessage: string | undefined,
  details?: ValidationDetails,
): string {
  if (code === 'read_timeout') {
    return 'The request timed out. Please check your connection and try again.';
  }
  if (code === 'network_error') {
    return 'Unable to reach the server. Check your internet connection and try again.';
  }
  if (code === 'request_cancelled') {
    return 'This action was interrupted before it finished. Please try again.';
  }
  if (code === 'rate_limit_exceeded' || status === 429) {
    return serverMessage?.trim() || 'Too many attempts right now. Please wait a moment and try again.';
  }
  if (code === 'poll_image_too_large' || code === 'avatar_too_large' || status === 413) {
    return 'The selected image is too large. Please choose a smaller file.';
  }
  if (code === 'validation_error' && details) {
    const entries = Object.entries(details);
    if (entries.length > 0) {
      return entries
        .slice(0, 2)
        .map(([field, messages]) => `${formatFieldLabel(field)}: ${messages[0]}`)
        .join(' ');
    }
  }
  if (serverMessage && serverMessage.trim().length > 0) {
    return serverMessage;
  }
  if (status >= 500 || code === 'internal_server_error') {
    return 'Something went wrong on our side. Please try again in a moment.';
  }
  if (status === 401) {
    return 'Please sign in to continue.';
  }
  return 'Request failed. Please try again.';
}

export function formatErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly details?: ValidationDetails,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ResponseDecoder<T> = (value: unknown) => T;

export class ApiClient {
  private onUnauthorized: (() => void) | null = null;
  private readonly requests = new Set<AbortController>();

  setOnUnauthorized(callback: (() => void) | null): void { this.onUnauthorized = callback; }

  cancelSessionRequests(): void {
    for (const controller of this.requests) controller.abort();
  }

  get<T>(path: string, decoder: ResponseDecoder<T>, signal?: AbortSignal, headers?: HeadersInit): Promise<T> {
    return this.send(path, { method: 'GET', signal, headers }, decoder);
  }

  send<T>(path: string, init: RequestInit, decoder: ResponseDecoder<T>): Promise<T> {
    const controller = new AbortController();
    this.requests.add(controller);
    const cancel = () => controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort!: (error: ApiError) => void;
    const onAbort = () => rejectAbort(
        controller.signal.reason instanceof ApiError ? controller.signal.reason :
          new ApiError(0, 'request_cancelled', formatApiErrorMessage(0, 'request_cancelled', undefined)),
    );
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (init.signal?.aborted) cancel();
    if (!controller.signal.aborted && (init.method ?? 'GET').toUpperCase() === 'GET') {
      timer = setTimeout(() => controller.abort(new ApiError(0, 'read_timeout', formatApiErrorMessage(0, 'read_timeout', undefined))), 10_000);
    }
    return Promise.race([
      this.request(path, { ...init, signal: controller.signal }, decoder, controller), aborted,
    ]).finally(() => {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort);
      this.requests.delete(controller);
    });
  }

  private async request<T>(path: string, init: RequestInit, decoder: ResponseDecoder<T>, controller: AbortController): Promise<T> {
    const checkActive = () => {
      if (init.signal?.aborted) throw new ApiError(0, 'request_cancelled', formatApiErrorMessage(0, 'request_cancelled', undefined));
    };
    checkActive();
    const headers = new Headers(init.headers);
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`, { ...init, headers, credentials: 'include' });
    } catch {
      throw new ApiError(0, 'network_error', formatApiErrorMessage(0, 'network_error', undefined));
    }

    checkActive();
    if (response.status === 204) return undefined as T;

    const body = await response.json().catch(() => undefined);
    checkActive();
    this.requests.delete(controller);
    const isCredentialAuth = path === '/auth/login' || path === '/auth/register';
    if (response.status === 401 && !isCredentialAuth) this.onUnauthorized?.();
    if (!response.ok) {
      const payload = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const code = typeof payload.error === 'string' ? payload.error : undefined;
      const serverMessage = typeof payload.message === 'string' ? payload.message : undefined;
      const details = parseValidationDetails(payload.details);
      throw new ApiError(
        response.status,
        code,
        formatApiErrorMessage(response.status, code, serverMessage, details),
        details,
      );
    }

    try { return decoder(body); } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'invalid_response', 'The server returned an unexpected response. Please try again.');
    }
  }
}

export const apiClient = new ApiClient();
