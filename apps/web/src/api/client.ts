export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message: string) {
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

  get<T>(path: string, decoder: ResponseDecoder<T>, signal?: AbortSignal): Promise<T> {
    return this.send(path, { method: 'GET', signal }, decoder);
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
          new ApiError(0, 'request_cancelled', 'The request was cancelled.'),
    );
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (init.signal?.aborted) cancel();
    if (!controller.signal.aborted && (init.method ?? 'GET').toUpperCase() === 'GET') {
      timer = setTimeout(() => controller.abort(new ApiError(0, 'read_timeout', 'The request timed out. Please try again.')), 10_000);
    }
    return Promise.race([
      this.request(path, { ...init, signal: controller.signal }, decoder), aborted,
    ]).finally(() => {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort);
      this.requests.delete(controller);
    });
  }

  private async request<T>(path: string, init: RequestInit, decoder: ResponseDecoder<T>): Promise<T> {
    const checkActive = () => {
      if (init.signal?.aborted) throw new ApiError(0, 'request_cancelled', 'The request was cancelled.');
    };
    checkActive();
    const headers = new Headers(init.headers);
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`, { ...init, headers, credentials: 'include' });
    } catch {
      throw new ApiError(0, 'network_error', 'The request could not be completed.');
    }

    checkActive();
    if (response.status === 204) return undefined as T;

    const body = await response.json().catch(() => undefined);
    checkActive();
    if (response.status === 401) this.onUnauthorized?.();
    if (!response.ok) {
      const payload = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
      throw new ApiError(response.status, typeof payload.error === 'string' ? payload.error : undefined, typeof payload.message === 'string' ? payload.message : 'Request failed.');
    }

    try { return decoder(body); } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'invalid_response', 'The server returned an invalid response.');
    }
  }
}

export const apiClient = new ApiClient();
