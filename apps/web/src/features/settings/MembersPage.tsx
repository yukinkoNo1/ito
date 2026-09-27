import { type AdminMemberDTO, MEMBER_COLORS } from '@ito/core';
import { useCallback, useEffect, useState } from 'react';
import { useData } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';

/** S-07b 家族の管理（管理者。オンラインで。素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function MembersPage() {
  const { store } = useData();
  const toast = useToast();
  const [members, setMembers] = useState<AdminMemberDTO[] | null>(null);
  const [form, setForm] = useState({
    login: '',
    name: '',
    mark: '',
    color: 'yamabuki',
    role: 'member',
  });

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/members');
      if (res.status === 200) setMembers((res.body as { members: AdminMemberDTO[] }).members);
    } catch {
      toast.show({ kind: 'error', message: '家のサーバーにつながりません', actionLabel: null });
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>) => {
    try {
      const res = await apiRequest(method, path, { body });
      if (res.status >= 400) {
        toast.show({
          kind: 'error',
          message: (res.body as { title?: string } | null)?.title ?? '保存できませんでした',
          actionLabel: null,
        });
        return false;
      }
      await load();
      await store.syncNow();
      return true;
    } catch {
      toast.show({ kind: 'error', message: '家のサーバーにつながりません', actionLabel: null });
      return false;
    }
  };

  if (!members) return <p>読み込み中…</p>;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl">家族の管理</h1>
      <ul>
        {members.map((m) => (
          <li key={m.id} className="border-b py-2">
            <p>
              {m.mark} {m.name}（{m.login}）{m.role === 'admin' ? ' 管理者' : ''}
              {m.disabled ? ' 無効' : ''}
            </p>
            <button
              type="button"
              className="min-h-11 px-3"
              onClick={() => void send('PATCH', `/api/members/${m.id}`, { disabled: !m.disabled })}
            >
              {m.disabled ? '有効にする' : '無効にする'}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2"
        aria-label="家族を追加"
        onSubmit={(e) => {
          e.preventDefault();
          void send('POST', '/api/members', form).then(
            (ok) => ok && setForm({ ...form, login: '', name: '', mark: '' }),
          );
        }}
      >
        <h2 className="font-bold">家族を追加</h2>
        <label className="flex flex-col">
          ログイン
          <input
            className="min-h-11 border px-2 text-base"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          名前
          <input
            className="min-h-11 border px-2 text-base"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          略称（1 文字）
          <input
            className="min-h-11 border px-2 text-base"
            value={form.mark}
            onChange={(e) => setForm({ ...form, mark: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          色
          <select
            className="min-h-11"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          >
            {MEMBER_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-11 px-3 font-bold">
          追加
        </button>
      </form>
    </div>
  );
}
