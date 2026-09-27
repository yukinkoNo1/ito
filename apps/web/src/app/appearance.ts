import { DEVICE_KEYS, readDevice, writeDevice } from '../pwa/device';

/**
 * テーマと文字の大きさ（§22）。html の data-theme（light / dark）と data-text-size（large のときだけ）で切り替える。
 * テーマは家族の設定（me.settings.theme）。「端末に合わせる」は prefers-color-scheme を見て付ける。
 * 起動直後に色がちらつかないよう、最後のテーマを端末にも写しておく。文字の大きさは端末ごと（§15）。
 * 端末の配色の監視は、このファイルの 1 か所だけが持つ（次のテーマを当てるときに前の監視を外す）
 */

export type ThemeSetting = 'system' | 'light' | 'dark';
export type TextSize = 'standard' | 'large';

/** ステータスバーなどの色（tokens.css の --paper と同じ。§17） */
const THEME_COLORS = { light: '#F9F6F2', dark: '#0F1217' } as const;

function darkQuery(): MediaQueryList | null {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  } catch {
    return null;
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

function paint(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  // 選んだテーマの色をステータスバーにも（端末の配色の media に関係なく）
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLORS[theme]);
  }
}

let current: ThemeSetting | null = null;
let stopFollowing: (() => void) | null = null;

/**
 * テーマを当てる。「端末に合わせる」なら端末の配色の切り替えにも追従する。
 * 前に当てたテーマの追従はここで外す（ライト・ダークを選んだあとに端末の配色で書き換わらないように）
 */
export function setTheme(setting: ThemeSetting): void {
  writeDevice(DEVICE_KEYS.theme, setting === 'system' ? null : setting);
  if (stopFollowing) {
    stopFollowing();
    stopFollowing = null;
  }
  current = setting;
  const query = darkQuery();
  paint(resolveTheme(setting, query?.matches === true));
  if (setting !== 'system' || !query) return;
  const follow = () => {
    if (current === 'system') paint(resolveTheme('system', query.matches));
  };
  query.addEventListener('change', follow);
  stopFollowing = () => query.removeEventListener('change', follow);
}

/** 起動直後（描画の前）に、端末に写しておいたテーマと文字の大きさを当てる */
export function applyStoredAppearance(): void {
  applyTextSize(readTextSize());
  setTheme(readThemeSetting());
}
