import { type DateISO, isValidDate } from '@ito/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { type Location, matchPath, useLocation, useNavigate } from 'react-router';

/**
 * 画面の上に重ねるもの（S-04 詳細のシート・S-05 書く画面）の開け閉め（§6.3）。
 * 詳細は `/e/:eventId?r=` に置き、開く前の画面（background）の上に重ねる。
 * 書く画面は今の URL の `?compose=1`（開け閉めは履歴に積まない。iPhone のホーム画面アプリには戻るがないため）
 */

export interface NavState {
  background?: Location;
}

export interface ComposerParams {
  editId: string | null;
  duplicateId: string | null;
  date: DateISO | null;
  time: string | null;
  text: string | null;
  /** 「くわしく」を開いた状態で開く（場所・メモを直すとき） */
  more: boolean;
}

export interface OpenComposerOptions {
  date?: DateISO;
  time?: string;
  edit?: string;
  duplicate?: string;
  text?: string;
  more?: boolean;
}

interface NavApi {
  /** 背景に描く画面の場所（詳細を開いているときは開く前の画面） */
  base: Location;
  detail: { eventId: string; recurrenceId: string | null } | null;
  composer: ComposerParams | null;
  openEvent: (key: string) => void;
  closeEvent: () => void;
  openComposer: (opts?: OpenComposerOptions) => void;
  closeComposer: () => void;
}

const NavContext = createContext<NavApi | null>(null);

const COMPOSER_KEYS = ['compose', 'edit', 'duplicate', 'date', 'time', 'text', 'more'] as const;

function homeLocation(key: string): Location {
  return { pathname: '/', search: '', hash: '', state: null, key };
}

export function NavProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  const api = useMemo<NavApi>(() => {
    const state = (location.state ?? null) as NavState | null;
    const match = matchPath('/e/:eventId', location.pathname);
    const params = new URLSearchParams(location.search);
    const detail = match?.params.eventId
      ? { eventId: match.params.eventId, recurrenceId: params.get('r') }
      : null;
    const base = detail ? (state?.background ?? homeLocation(`${location.key}-home`)) : location;
    const date = params.get('date');
    const composer: ComposerParams | null =
      params.get('compose') === '1'
        ? {
            editId: params.get('edit'),
            duplicateId: params.get('duplicate'),
            date: date && isValidDate(date) ? date : null,
            time: params.get('time'),
            text: params.get('text'),
            more: params.get('more') === '1',
          }
        : null;

    const withParams = (edit: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(location.search);
      edit(next);
      const search = next.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: true, state: location.state },
      );
    };

    return {
      base,
      detail,
      composer,
      openEvent: (key) => {
        const at = key.indexOf('@');
        const eventId = at === -1 ? key : key.slice(0, at);
        const rid = at === -1 ? null : key.slice(at + 1);
        const background = detail ? base : location;
        navigate(
          { pathname: `/e/${eventId}`, search: rid ? `?r=${encodeURIComponent(rid)}` : '' },
          { state: { background } satisfies NavState },
        );
      },
      closeEvent: () => {
        // アプリの中から開いたなら戻る（背景の画面に戻る）。通知などで直接開いたなら「これから」へ
        if (state?.background) navigate(-1);
        else navigate('/', { replace: true });
      },
      openComposer: (opts = {}) =>
        withParams((p) => {
          for (const k of COMPOSER_KEYS) p.delete(k);
          p.set('compose', '1');
          if (opts.date) p.set('date', opts.date);
          if (opts.time) p.set('time', opts.time);
          if (opts.edit) p.set('edit', opts.edit);
          if (opts.duplicate) p.set('duplicate', opts.duplicate);
          if (opts.text) p.set('text', opts.text);
          if (opts.more) p.set('more', '1');
        }),
      closeComposer: () =>
        withParams((p) => {
          for (const k of COMPOSER_KEYS) p.delete(k);
        }),
    };
  }, [location, navigate]);

  return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

/** 戻る。アプリの中から来たなら前の画面へ、直接開いたなら fallback へ（iPhone のホーム画面アプリには戻るがない） */
export function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback, { replace: true });
}

export function useNav(): NavApi {
  const v = useContext(NavContext);
  if (!v) throw new Error('NavProvider がありません');
  return v;
}
