export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type ResponseDecoder<T> = (value: unknown) => T;

export class ApiClient {
  private accessToken: string | null = null;
  private onUnauthorized: (() => void) | null = null;

  setAccessToken(token: string): void { this.accessToken = token; }
  clearAccessToken(): void { this.accessToken = null; }
  setOnUnauthorized(callback: (() => void) | null): void { this.onUnauthorized = callback; }

  get<T>(path: string, decoder: ResponseDecoder<T>): Promise<T> {
    return this.send(path, { method: 'GET' }, decoder);
  }

  send<T>(path: string, init: RequestInit, decoder: ResponseDecoder<T>): Promise<T> {
    return this.request(path, init, decoder);
  }

  private async request<T>(path: string, init: RequestInit, decoder: ResponseDecoder<T>): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);

    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, 'network_error', 'The request could not be completed.');
    }

    if (response.status === 401) this.onUnauthorized?.();
    if (response.status === 204) return undefined as T;

    const body = await response.json().catch(() => undefined);
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
