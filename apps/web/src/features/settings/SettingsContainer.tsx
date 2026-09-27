import { type AdminMemberDTO, adminMemberDtoSchema } from '@ito/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { applyTheme, readTextSize, saveTextSize, type TextSize } from '../../app/appearance';
import { useData, useMe, useMembers } from '../../app/data-context';
import { sendOnline } from '../../app/online-actions';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import { detectPlatform, isStandalone } from '../../pwa/install';
import { logoutThisDevice } from '../../pwa/logout';
import SettingsScreen from '../../ui/screens/SettingsScreen';
import type { AdminMemberVM, NotificationPermissionVM } from '../../ui/types';
import { buildSettingsVM } from '../../viewmodels/screens';

export const membersResponse = z.object({ members: z.array(adminMemberDtoSchema) });

export function toAdminMemberVMs(members: AdminMemberDTO[], meId: string): AdminMemberVM[] {
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    mark: m.mark,
    color: m.color,
    isMe: m.id === meId,
    login: m.login,
    role: m.role,
    disabled: m.disabled,
    deviceCount: m.deviceCount,
  }));
}

/** 通知の許可の状態（iPhone でホーム画面に未追加なら needs-install。通知そのものは Phase 4） */
function notificationPermission(): NotificationPermissionVM {
  if (detectPlatform() === 'ios' && !isStandalone()) return 'needs-install';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** S-07 設定 */
export function SettingsContainer() {
  const me = useMe();
  const members = useMembers();
  const { db, store } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const [admin, setAdmin] = useState<AdminMemberDTO[]>([]);
  const isAdmin = me?.role === 'admin';

  // 管理者は家族の人数を出すために一覧を読む（オンラインのときだけ）
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiRequest('GET', '/api/members');
        const parsed = membersResponse.safeParse(res.body);
        if (!cancelled && res.status === 200 && parsed.success) setAdmin(parsed.data.members);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!me) return <p className="detail-meta">読み込み中…</p>;
  const patchMe = (body: Record<string, unknown>) =>
    sendOnline(store, toast.show, 'PATCH', '/api/me', body);

  const vm = buildSettingsVM({
    me,
    members,
    adminMembers: toAdminMemberVMs(admin, me.id),
    textSize,
    permission: notificationPermission(),
    devices: [],
    install: { platform: detectPlatform(), installed: isStandalone() },
    appVersion: __ITO_VERSION__,
  });

  return (
    <SettingsScreen
      onChangeNotifications={(patch) => void patchMe({ settings: { notifications: patch } })}
      onChangeProfile={(patch) => void patchMe(patch)}
      onChangeTextSize={(size) => {
        saveTextSize(size);
        setTextSize(size);
      }}
      onChangeTheme={(theme) => {
        // すぐに当ててから保存する（保存できなければ、次の同期で元のテーマに戻る）
        applyTheme(theme);
        void patchMe({ settings: { theme } });
      }}
      onChangeWeekStart={(weekStart) => void patchMe({ settings: { weekStart } })}
      onEnableNotifications={() => {}}
      onExport={() => {}}
      onLogoutDevice={() => {
        void logoutThisDevice(db).then(() => {
          window.location.assign('/welcome');
        });
      }}
      onOpenActivity={() => navigate('/activity')}
      onOpenInstallGuide={() => navigate('/install')}
      onOpenMembers={() => navigate('/settings/members')}
      onOpenTrash={() => navigate('/trash')}
      onRemoveDevice={() => {}}
      onTestNotification={() => {}}
      vm={vm}
    />
  );
}
