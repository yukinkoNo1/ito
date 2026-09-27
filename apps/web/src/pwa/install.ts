/** インストール判定（§17: display-mode: standalone と navigator.standalone） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (
    /Macintosh/.test(userAgent) &&
    typeof navigator !== 'undefined' &&
    navigator.maxTouchPoints > 1
  )
    return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Android の Chrome のインストールダイアログ（beforeinstallprompt）を取っておく */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    for (const fn of listeners) fn();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    for (const fn of listeners) fn();
    void requestPersistence();
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice;
  for (const fn of listeners) fn();
  return choice.outcome === 'accepted';
}

/** インストール後に永続化を要求する（§17） */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist();
  } catch {}
}
