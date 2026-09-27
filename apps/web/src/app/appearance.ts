import { DEVICE_KEYS, readDevice, writeDevice } from '../pwa/device';

/**
 * テーマと文字の大きさ（§22）。html の data-theme（light / dark）と data-text-size（large のときだけ）で切り替える。
 * テーマは家族の設定（me.settings.theme）。「端末に合わせる」は prefers-color-scheme を見て付ける。
 * 起動直後に色がちらつかないよう、最後のテーマを端末にも写しておく。文字の大きさは端末ごと（§15）
 */

export type ThemeSetting = 'system' | 'light' | 'dark';
export type TextSize = 'standard' | 'large';

function prefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  } catch {
    return false;
  }
}

export function resolveTheme(setting: ThemeSetting, systemDark: boolean): 'light' | 'dark' {
  if (setting === 'system') return systemDark ? 'dark' : 'light';
  return setting;
}

export function readThemeSetting(): ThemeSetting {
  const v = readDevice(DEVICE_KEYS.theme);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function readTextSize(): TextSize {
  return readDevice(DEVICE_KEYS.textSize) === 'large' ? 'large' : 'standard';
}

export function applyTextSize(size: TextSize): void {
  const html = document.documentElement;
  if (size === 'large') html.dataset.textSize = 'large';
  else delete html.dataset.textSize;
}

export function saveTextSize(size: TextSize): void {
  writeDevice(DEVICE_KEYS.textSize, size === 'large' ? 'large' : null);
  applyTextSize(size);
}

/** テーマを当てる。「端末に合わせる」なら端末の切り替えにも追従する（戻り値で追従をやめる） */
export function applyTheme(setting: ThemeSetting): () => void {
  writeDevice(DEVICE_KEYS.theme, setting === 'system' ? null : setting);
  const set = () => {
    document.documentElement.dataset.theme = resolveTheme(setting, prefersDark());
  };
  set();
  if (setting !== 'system') return () => {};
  let mql: MediaQueryList | null = null;
  try {
    mql = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  } catch {}
  mql?.addEventListener('change', set);
  return () => mql?.removeEventListener('change', set);
}

/** 起動直後（描画の前）に、端末に写しておいたテーマと文字の大きさを当てる */
export function applyStoredAppearance(): () => void {
  applyTextSize(readTextSize());
  return applyTheme(readThemeSetting());
}
