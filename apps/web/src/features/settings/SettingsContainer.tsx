import {
  type AdminMemberDTO,
  adminMemberDtoSchema,
  type DeviceDTO,
  deviceDtoSchema,
} from '@ito/core';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { readTextSize, saveTextSize, setTheme, type TextSize } from '../../app/appearance';
import { useData, useMe, useMembers } from '../../app/data-context';
import { sendOnline } from '../../app/online-actions';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import { detectPlatform, isStandalone } from '../../pwa/install';
import { logoutThisDevice } from '../../pwa/logout';
import {
  enablePush,
  loadPublicKey,
  notificationPermission,
  thisDeviceSubscriptionId,
  unsubscribePush,
} from '../../pwa/push';
import SettingsScreen from '../../ui/screens/SettingsScreen';
import type { AdminMemberVM, NotificationPermissionVM } from '../../ui/types';
import { toDeviceVMs } from '../../viewmodels/devices';
import { buildSettingsVM } from '../../viewmodels/screens';

export const membersResponse = z.object({ members: z.array(adminMemberDtoSchema) });
const devicesResponse = z.object({ devices: z.array(deviceDtoSchema) });

const ENABLE_MESSAGES = {
  enabled: 'この端末で通知を受け取ります',
  denied: '通知が許可されませんでした。端末の設定で許可できます',
  unsupported: 'この端末やブラウザでは通知を使えません',
  unavailable: '家のサーバーで通知の設定がされていません',
  failed: '通知をオンにできませんでした。しばらくしてからやり直してください',
} as const;

const TEST_MESSAGES: Record<string, string> = {
  sent: 'テスト通知を送りました',
  unavailable: '家のサーバーで通知の設定がされていません',
  none: '通知を受け取る端末がありません。先に「通知をオンにする」を押してください',
  gone: 'この端末の通知が止まっていました。もう一度「通知をオンにする」を押してください',
  retry: '通知を送れませんでした。しばらくしてからやり直してください',
  failed: '通知を送れませんでした',
};

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

/** S-07 設定 */
export function SettingsContainer() {
  const me = useMe();
  const members = useMembers();
  const { db, store, clock } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const [admin, setAdmin] = useState<AdminMemberDTO[]>([]);
  const [permission, setPermission] = useState<NotificationPermissionVM>(notificationPermission);
  const [devices, setDevices] = useState<DeviceDTO[]>([]);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const isAdmin = me?.role === 'admin';
  const showToast = toast.show;

  // 通知を受け取る端末（オンラインのときだけ。この端末には印を付ける）
  const loadDevices = useCallback(async () => {
    try {
      const current = thisDeviceSubscriptionId();
      const res = await apiRequest(
        'GET',
        `/api/push/subscriptions${current ? `?current=${encodeURIComponent(current)}` : ''}`,
      );
      const parsed = devicesResponse.safeParse(res.body);
      if (res.status === 200 && parsed.success) setDevices(parsed.data.devices);
    } catch {}
  }, []);

  // 公開鍵は画面を開いたときに取っておく（ボタンを押したあと最初に待つのは許可のダイアログ。§15）
  useEffect(() => {
    let cancelled = false;
    void loadPublicKey().then((key) => {
      if (!cancelled) setPublicKey(key);
    });
    void loadDevices();
    const onVisible = () => {
      if (document.visibilityState === 'visible') setPermission(notificationPermission());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadDevices]);

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
    permission,
    devices: toDeviceVMs(devices, clock.now()),
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
        // すぐに当ててから保存する。保存できなければ、家族の設定のテーマに戻す
        const before = me.settings.theme;
        setTheme(theme);
        void patchMe({ settings: { theme } }).then((ok) => {
          if (!ok) setTheme(before);
        });
      }}
      onChangeWeekStart={(weekStart) => void patchMe({ settings: { weekStart } })}
      onEnableNotifications={() => {
        // 最初に待つのは requestPermission（enablePush の中）。その前に await を置かない
        void enablePush(publicKey).then((result) => {
          setPermission(notificationPermission());
          showToast({
            kind: result === 'enabled' ? 'info' : 'error',
            message: ENABLE_MESSAGES[result],
            actionLabel: null,
          });
          if (result === 'enabled') void loadDevices();
        });
      }}
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
      onRemoveDevice={(id) => {
        void (async () => {
          // この端末なら、ブラウザの購読もやめる（サーバーの購読も消える）
          if (id === thisDeviceSubscriptionId()) await unsubscribePush();
          else if (
            !(await sendOnline(store, showToast, 'DELETE', `/api/push/subscriptions/${id}`, {}))
          )
            return;
          showToast({ kind: 'info', message: 'その端末への通知を止めました', actionLabel: null });
          await loadDevices();
        })();
      }}
      onTestNotification={() => {
        void (async () => {
          try {
            const res = await apiRequest('POST', '/api/push/test', { body: {} });
            const result = (res.body as { result?: unknown } | null)?.result;
            const message =
              res.status === 200 && typeof result === 'string'
                ? (TEST_MESSAGES[result] ?? TEST_MESSAGES.failed)
                : res.status === 429
                  ? '少し待ってから送ってください'
                  : TEST_MESSAGES.failed;
            showToast({
              kind: res.status === 200 && result === 'sent' ? 'info' : 'error',
              message: message as string,
              actionLabel: null,
            });
            void loadDevices();
          } catch {
            showToast({
              kind: 'error',
              message: '家のサーバーにつながりません',
              actionLabel: null,
            });
          }
        })();
      }}
      vm={vm}
    />
  );
}
