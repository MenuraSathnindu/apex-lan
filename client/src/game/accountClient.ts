import type {
  ApiError,
  AuthResponse,
  CreateProfileRequest,
  HallOfFameEntry,
  ProfilePage,
  ProfileSummary,
  UpdateProfileRequest,
} from '@apex/shared';

const TOKEN_KEY = 'apex.login';

/** An API call that failed: the server's message (or a network error) and the HTTP status. */
export class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The host's profile API, plus the login token remembered in this browser (localStorage,
 * so every tab on this device is logged in as the same profile until it logs out).
 */
export class AccountClient {
  private tokenValue: string | null = null;

  constructor() {
    try {
      this.tokenValue = localStorage.getItem(TOKEN_KEY);
    } catch {
      // Storage blocked: you just log in each time.
    }
  }

  get token(): string | null {
    return this.tokenValue;
  }

  private setToken(token: string | null) {
    this.tokenValue = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Not fatal.
    }
  }

  /** Forget the login on this device without telling the server (e.g. the host deleted its database). */
  forget(): void {
    this.setToken(null);
  }

  private async call<T>(method: string, path: string, body?: BodyInit | object, raw = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.tokenValue) headers.Authorization = `Bearer ${this.tokenValue}`;
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      if (raw) {
        payload = body as BodyInit;
        headers['Content-Type'] = 'application/octet-stream';
      } else {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: payload });
    } catch {
      throw new ApiCallError('cannot reach the host', 0);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (e.g. an old server answering with the app page).
    }
    if (!res.ok || data === null) throw new ApiCallError((data as ApiError | null)?.error ?? `request failed (${res.status})`, res.status);
    return data as T;
  }

  async create(req: CreateProfileRequest): Promise<ProfileSummary> {
    const res = await this.call<AuthResponse>('POST', '/api/profiles', req);
    this.setToken(res.token);
    return res.profile;
  }

  async login(name: string, pin: string): Promise<ProfileSummary> {
    const res = await this.call<AuthResponse>('POST', '/api/login', { name, pin });
    this.setToken(res.token);
    return res.profile;
  }

  async logout(): Promise<void> {
    try {
      if (this.tokenValue) await this.call('POST', '/api/logout', {});
    } finally {
      this.setToken(null);
    }
  }

  update(req: UpdateProfileRequest): Promise<ProfileSummary> {
    return this.call('PATCH', '/api/me', req);
  }

  uploadPhoto(file: Blob): Promise<ProfileSummary> {
    return this.call('PUT', '/api/me/photo', file, true);
  }

  removePhoto(): Promise<ProfileSummary> {
    return this.call('DELETE', '/api/me/photo');
  }

  profilePage(id: number): Promise<ProfilePage> {
    return this.call('GET', `/api/profiles/${id}`);
  }

  hallOfFameTracks(): Promise<{ tracks: string[] }> {
    return this.call('GET', '/api/hall-of-fame');
  }

  hallOfFame(trackId: string): Promise<HallOfFameEntry[]> {
    return this.call('GET', `/api/hall-of-fame/${encodeURIComponent(trackId)}`);
  }
}
