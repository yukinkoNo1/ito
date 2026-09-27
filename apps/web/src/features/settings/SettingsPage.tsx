import { MEMBER_COLORS, type MemberColor } from '@ito/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { useData, useMe, useMembers } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { apiRequest, devLogin, setDevLogin } from '../../data/api';

/** S-07 設定（素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function SettingsPage() {
  const me = useMe();
  const members = useMembers();
  const { store } = useData();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);

  if (!me) return <p>読み込み中…</p>;
  const taken = new Set(members.filter((m) => m.id !== me.id && !m.disabled).map((m) => m.color));

  const patchMe = async (body: Record<string, unknown>) => {
    try {
      const res = await apiRequest('PATCH', '/api/me', { body });
      if (res.status !== 200) {
        const title = (res.body as { title?: string } | null)?.title ?? '保存できませんでした';
        toast.show({ kind: 'error', message: title, actionLabel: null });
        return;
      }
      await store.syncNow();
    } catch {
      toast.show({ kind: 'error', message: '家のサーバーにつながりません', actionLabel: null });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl">設定</h1>
      <section aria-label="表示">
        <h2 className="font-bold">表示</h2>
        <label className="flex min-h-11 items-center gap-2">
          テーマ
          <select
            value={me.settings.theme}
            onChange={(e) => void patchMe({ settings: { theme: e.target.value } })}
          >
            <option value="system">端末に合わせる</option>
            <option value="light">ライト</option>
            <option value="dark">ダーク</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2">
          週の始まり
          <select
            value={me.settings.weekStart}
            onChange={(e) => void patchMe({ settings: { weekStart: Number(e.target.value) } })}
          >
            <option value={0}>日曜</option>
            <option value={1}>月曜</option>
          </select>
        </label>
      </section>
      <section aria-label="自分">
        <h2 className="font-bold">自分</h2>
        <label className="flex flex-col">
          名前
          <input
            className="min-h-11 border px-2 text-base"
            value={name ?? me.name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="min-h-11 px-3"
          onClick={() => void patchMe({ name: name ?? me.name })}
        >
          名前を保存
        </button>
        <fieldset>
          <legend>色</legend>
          {MEMBER_COLORS.map((c: MemberColor) => (
            <label key={c} className="mr-2 inline-flex min-h-11 items-center gap-1">
              <input
                type="radio"
                name="color"
                checked={me.color === c}
                disabled={taken.has(c)}
                onChange={() => void patchMe({ color: c })}
              />
              {c}
            </label>
          ))}
        </fieldset>
      </section>
      <section aria-label="家族・データ">
        <h2 className="font-bold">家族・データ</h2>
        <ul>
          {me.role === 'admin' && (
            <li>
              <Link className="inline-block min-h-11 py-2" to="/settings/members">
                家族の管理
              </Link>
            </li>
          )}
          <li>
            <Link className="inline-block min-h-11 py-2" to="/activity">
              履歴
            </Link>
          </li>
          <li>
            <Link className="inline-block min-h-11 py-2" to="/trash">
              ゴミ箱
            </Link>
          </li>
        </ul>
      </section>
      {(import.meta.env.DEV || __ITO_E2E__) && (
        <section aria-label="開発用">
          <h2 className="font-bold">開発用のログイン</h2>
          <label className="flex min-h-11 items-center gap-2">
            X-Dev-Login
            <input
              className="border px-2 text-base"
              defaultValue={devLogin() ?? ''}
              onBlur={(e) => {
                setDevLogin(e.target.value.trim() || null);
                void store.syncNow();
              }}
            />
          </label>
        </section>
      )}
    </div>
  );
}
