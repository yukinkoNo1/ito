import type { AdminMemberDTO } from '@ito/core';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useData, useMe } from '../../app/data-context';
import { sendOnline } from '../../app/online-actions';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import MembersAdminScreen from '../../ui/screens/MembersAdminScreen';
import { membersResponse, toAdminMemberVMs } from './SettingsContainer';

/** S-07b 家族の管理（管理者。オンラインで） */
export function MembersContainer() {
  const me = useMe();
  const { store } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [members, setMembers] = useState<AdminMemberDTO[]>([]);
  const showToast = toast.show;

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/members');
      const parsed = membersResponse.safeParse(res.body);
      if (res.status === 200 && parsed.success) setMembers(parsed.data.members);
      else showToast({ kind: 'error', message: '家族の一覧を読めませんでした', actionLabel: null });
    } catch {
      showToast({ kind: 'error', message: '家のサーバーにつながりません', actionLabel: null });
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return <p className="detail-meta">読み込み中…</p>;
  const send = async (method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>) => {
    if (await sendOnline(store, showToast, method, path, body)) await load();
  };

  return (
    <MembersAdminScreen
      members={toAdminMemberVMs(members, me.id)}
      onAdd={(input) => void send('POST', '/api/members', input)}
      onBack={() => navigate('/settings')}
      onRevokeDevices={() => {}}
      onUpdate={(id, patch) => void send('PATCH', `/api/members/${id}`, patch)}
    />
  );
}
