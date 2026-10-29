import { SYNC_FILE, type DriveTransport } from './sync';

/**
 * Google sign-in (Google Identity Services, token model) and the Drive REST calls, all in the
 * browser: no server of ours. Only the app's hidden folder (`drive.appdata`) is asked for, so the
 * app can see nothing else in the player's Drive. The sign-in script is loaded from Google only
 * when the player presses "Lưu lên Drive" (the one exception to "no network": CLAUDE.md).
 *
 * Tokens last about an hour and the browser gets no refresh token: when one runs out, getting a
 * new one may open Google's popup, so that only ever happens from a click (`connect`).
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** The OAuth client id, set at build time (`VITE_GOOGLE_CLIENT_ID`); empty: no Drive sync. */
export const CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

// The part of the Google Identity Services API used here (it has no types of its own here).
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}
interface GoogleAccounts {
  oauth2: {
    initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }): TokenClient;
    revoke(token: string, done?: () => void): void;
  };
}

let gisLoading: Promise<GoogleAccounts> | null = null;

function loadGis(): Promise<GoogleAccounts> {
  gisLoading ??= new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: GoogleAccounts } };
    if (w.google?.accounts) {
      resolve(w.google.accounts);
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (w.google?.accounts ? resolve(w.google.accounts) : reject(new Error('Google sign-in did not load')));
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Google sign-in could not be loaded (offline?)'));
    };
    document.head.append(s);
  });
  return gisLoading;
}

export class DriveAuth {
  private token = '';
  private expires = 0;

  get valid(): boolean {
    return this.token !== '' && Date.now() < this.expires - 60_000;
  }

  /**
   * Asks Google for access. Call only from a click: it may open Google's window (the first time
   * to choose the account and allow it; later it usually closes by itself).
   */
  async connect(first: boolean): Promise<void> {
    const accounts = await loadGis();
    await new Promise<void>((resolve, reject) => {
      const client = accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) {
            reject(new Error(r.error ?? 'no token'));
            return;
          }
          this.token = r.access_token;
          this.expires = Date.now() + (r.expires_in ?? 3600) * 1000;
          resolve();
        },
        error_callback: (e) => reject(new Error(e.type ?? 'sign-in cancelled')),
      });
      client.requestAccessToken({ prompt: first ? 'consent' : '' });
    });
  }

  /** Forgets the token and tells Google to drop the permission. */
  async disconnect(): Promise<void> {
    const token = this.token;
    this.token = '';
    this.expires = 0;
    if (!token) return;
    try {
      const accounts = await loadGis();
      accounts.oauth2.revoke(token);
    } catch {
      // Offline: the token runs out by itself within the hour.
    }
  }

  /** Drive calls with the current token. */
  transport(): DriveTransport {
    const auth = (): HeadersInit => ({ Authorization: `Bearer ${this.token}` });
    const check = async (r: Response): Promise<Response> => {
      if (r.status === 401) {
        this.token = '';
        throw new Error('expired');
      }
      if (!r.ok) throw new Error(`Drive ${r.status}`);
      return r;
    };
    return {
      find: async () => {
        const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
        const r = await check(await fetch(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`, { headers: auth() }));
        const json = (await r.json()) as { files?: Array<{ id: string }> };
        return json.files?.[0]?.id ?? null;
      },
      download: async (id) => (await check(await fetch(`${API}/${id}?alt=media`, { headers: auth() }))).text(),
      create: async (body) => {
        const boundary = `tsw${Date.now().toString(36)}`;
        const meta = JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
        const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
        const r = await check(
          await fetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: { ...auth(), 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: payload,
          }),
        );
        return ((await r.json()) as { id: string }).id;
      },
      update: async (id, body) => {
        await check(
          await fetch(`${UPLOAD}/${id}?uploadType=media`, {
            method: 'PATCH',
            headers: { ...auth(), 'Content-Type': 'application/json' },
            body,
            // Lets the last upload finish when the tab is being closed.
            keepalive: body.length < 60_000,
          }),
        );
      },
    };
  }
}
