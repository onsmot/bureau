import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

export interface DriveAuthUser {
  email: string | null;
  displayName?: string | null;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GisErrorResponse {
  type?: 'popup_failed_to_open' | 'popup_closed' | string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (error: GisErrorResponse) => void;
          }) => GisTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
// Access token strictly cached in memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUser: DriveAuthUser | null = null;
let gisScriptPromise: Promise<void> | null = null;

export const preloadGoogleIdentityScript = (): Promise<void> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Окно браузера недоступно.'));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisScriptPromise) {
    return gisScriptPromise;
  }

  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          gisScriptPromise = null;
          reject(new Error('Не удалось загрузить Google Identity Services.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisScriptPromise = null;
      reject(new Error('Не удалось загрузить скрипт авторизации Google.'));
    };
    document.head.appendChild(script);
  });

  return gisScriptPromise;
};

export const initAuth = (
  onAuthSuccess?: (user: DriveAuthUser, token: string) => void,
  onAuthFailure?: (user: DriveAuthUser | null) => void
) => {
  return onAuthStateChanged(auth, (firebaseUser: User | null) => {
    if (cachedAccessToken) {
      const effectiveUser: DriveAuthUser = cachedUser || {
        email: firebaseUser?.email || 'Google Диск подключён',
        displayName: firebaseUser?.displayName || null,
      };
      onAuthSuccess?.(effectiveUser, cachedAccessToken);
      return;
    }

    if (firebaseUser) {
      if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.({
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
        });
      }
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      cachedUser = null;
      onAuthFailure?.(null);
    }
  });
};

async function fetchDriveProfile(accessToken: string): Promise<DriveAuthUser> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (res.ok) {
      const data = await res.json();
      const email = data?.user?.emailAddress || 'Google Диск подключён';
      const displayName = data?.user?.displayName || null;
      return { email, displayName };
    }
  } catch {
    // Fallback below if Drive about lookup fails
  }
  return { email: 'Google Диск подключён', displayName: null };
}

/**
 * Direct OAuth 2.0 Token Client via Google Identity Services (GIS).
 * Works cleanly inside iframes because it does not depend on Firebase's hidden __/auth/iframe.
 */
export const googleSignInWithGis = async (): Promise<{
  user: DriveAuthUser;
  accessToken: string;
}> => {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId) {
    throw new Error('OAuth Client ID не найден в конфигурации приложения.');
  }

  if (!window.google?.accounts?.oauth2) {
    await preloadGoogleIdentityScript();
  }

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Модуль Google Identity Services не инициализировался.');
  }

  isSigningIn = true;
  try {
    const tokenResponse = await new Promise<GisTokenResponse>((resolve, reject) => {
      let settled = false;
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        prompt: 'select_account',
        callback: (resp: GisTokenResponse) => {
          if (settled) return;
          settled = true;
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error_description ||
                  (resp.error === 'access_denied'
                    ? 'Доступ к Google Диску был отклонён пользователем.'
                    : `Ошибка OAuth Google: ${resp.error || 'токен не получен'}`)
              )
            );
            return;
          }
          resolve(resp);
        },
        error_callback: (err: GisErrorResponse) => {
          if (settled) return;
          settled = true;
          if (err.type === 'popup_failed_to_open') {
            reject(
              new Error(
                'Браузер заблокировал всплывающее окно входа Google. Разрешите всплывающие окна для сайта и повторите попытку.'
              )
            );
            return;
          }
          if (err.type === 'popup_closed') {
            reject(
              new Error(
                'Окно входа Google закрылось до получения ответа. Если вы нажали «Разрешить», проверьте, не блокирует ли браузер (или режим инкогнито) сторонние окна/cookies, либо попробуйте «Резервный вход (Firebase)».'
              )
            );
            return;
          }
          reject(new Error(err.message || 'Не удалось завершить вход через Google.'));
        },
      });

      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });

    const accessToken = tokenResponse.access_token!;
    const profile = await fetchDriveProfile(accessToken);
    cachedAccessToken = accessToken;
    cachedUser = profile;
    return { user: profile, accessToken };
  } finally {
    isSigningIn = false;
  }
};

/**
 * Fallback Firebase Auth signInWithPopup flow.
 */
export const googleSignInWithFirebase = async (): Promise<{
  user: DriveAuthUser;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Не удалось получить токен доступа Google Диска.');
    }
    const profile: DriveAuthUser = {
      email: result.user.email,
      displayName: result.user.displayName,
    };
    cachedAccessToken = credential.accessToken;
    cachedUser = profile;
    return { user: profile, accessToken: cachedAccessToken };
  } catch (err: any) {
    if (err?.code === 'auth/popup-closed-by-user') {
      throw new Error(
        'Firebase Auth сообщил auth/popup-closed-by-user (внутри iframe браузер часто изолирует хранилище окна входа после нажатия «Разрешить»). Нажмите основную кнопку «Sign in with Google» для прямого входа.'
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const googleSignIn = googleSignInWithGis;

export const getAccessToken = (): string | null => cachedAccessToken;

export const clearAccessToken = () => {
  cachedAccessToken = null;
  cachedUser = null;
};

export const logout = async () => {
  const tokenToRevoke = cachedAccessToken;
  cachedAccessToken = null;
  cachedUser = null;
  if (tokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(tokenToRevoke);
    } catch {
      // Ignore revoke errors
    }
  }
  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase signOut errors when using GIS-only session
  }
};

