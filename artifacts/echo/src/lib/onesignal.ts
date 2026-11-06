/** OneSignal is initialized only after the public app ID has been configured. */
type OneSignalClient = {
  init(options: Record<string, unknown>): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  User: { addTags(tags: Record<string, string>): Promise<void> };
  Notifications: { requestPermission(): Promise<boolean>; permission: boolean };
  UserPushSubscription?: unknown;
};
declare global {
  interface Window {
    OneSignalDeferred?: Array<(client: OneSignalClient) => void | Promise<void>>;
  }
}
let scriptPromise: Promise<void> | null = null;
let initialized: Promise<OneSignalClient> | null = null;
// OneSignal App ID is public (unlike the server REST API key).
const appId = '96bd4106-2422-40f1-a5dd-238b511758d8';
export const isOneSignalConfigured = () => Boolean(appId && /^[a-f0-9-]{36}$/i.test(appId));

function loadScript(): Promise<void> {
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar OneSignal'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function getOneSignal(): Promise<OneSignalClient> {
  if (!isOneSignalConfigured()) throw new Error('Falta configurar OneSignal en ECHO');
  if (!initialized) initialized = (async () => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    const ready = new Promise<OneSignalClient>((resolve, reject) => {
      window.OneSignalDeferred!.push(async client => {
        try {
          await client.init({
            appId,
            notifyButton: { enable: false },
            autoResubscribe: true,
            serviceWorkerPath: 'onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/onesignal/' },
            allowLocalhostAsSecureOrigin: false,
          });
          resolve(client);
        } catch (error) { reject(error); }
      });
    });
    await loadScript();
    return ready;
  })().catch(error => { initialized = null; throw error; });
  return initialized;
}

export async function connectOneSignalOwner(ownerId: string): Promise<void> {
  if (!isOneSignalConfigured()) return;
  const client = await getOneSignal();
  await client.login(ownerId);
}

export async function disconnectOneSignalOwner(): Promise<void> {
  if (!isOneSignalConfigured() || !initialized) return;
  const client = await initialized;
  await client.logout();
}
