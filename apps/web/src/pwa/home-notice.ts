import type { HomeNoticeVM } from '../ui/types';
import { DEVICE_KEYS, readDevice } from './device';
import { isStandalone } from './install';
import { notificationPermission, pushOptedOut } from './push';

/** ホームの案内（F-23）。ホーム画面に未追加なら「ホーム画面に追加」、追加済みで通知の許可がまだなら「通知をオンにする」（§15） */
export const INSTALL_NOTICE: HomeNoticeVM = {
  kind: 'install',
  message: 'ホーム画面に追加すると、アプリのようにすぐ開けます',
  actionLabel: '追加の方法',
};

export const NOTIFICATIONS_NOTICE: HomeNoticeVM = {
  kind: 'notifications',
  message: '通知をオンにすると、予定の前や家族が予定を変えたときに知らせます',
  actionLabel: '通知をオンにする',
};

export type NoticeKind = 'install' | 'notifications';

/** 出す案内（閉じた案内は、その端末では出さない） */
export function homeNoticeKind(): NoticeKind | null {
  if (!isStandalone()) {
    return readDevice(DEVICE_KEYS.installNoticeDismissed) !== '1' ? 'install' : null;
  }
  // この端末で自分で止めた（ログアウト・この端末の削除）なら、ホームでは案内しない（設定からオンにできる）
  if (
    notificationPermission() === 'default' &&
    !pushOptedOut() &&
    readDevice(DEVICE_KEYS.notificationsNoticeDismissed) !== '1'
  ) {
    return 'notifications';
  }
  return null;
}
