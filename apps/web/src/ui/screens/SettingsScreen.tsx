import { Bell, ChevronRight, Database, Info, Smartphone, Type, User, Users } from 'lucide-react';
import { useState } from 'react';
import { reminderLabel } from '../labels';
import { Button, Input } from '../primitives/Controls';
import type { MemberColor, NotificationSettingsVM, SettingsScreenProps, TimeHM } from '../types';

export const COLOR_LABELS: Record<MemberColor, string> = {
  yamabuki: '山吹',
  wakakusa: '若草',
  wakatake: '若竹',
  asagi: '浅葱',
  fuji: '藤',
  momo: '桃',
  ruri: '瑠璃',
  kaki: '柿',
};

type SettingRowProps = {
  label: string;
  value?: string;
  danger?: boolean;
  onClick?: () => void;
};

function SettingRow({ label, value, danger, onClick }: SettingRowProps) {
  return (
    <Button className={`setting-row ${danger ? 'setting-row--danger' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <span>
        {value && <strong>{value}</strong>}
        <ChevronRight aria-hidden="true" />
      </span>
    </Button>
  );
}

type Option = { label: string; apply: () => void; pressed?: boolean };
type Panel =
  | { kind: 'options'; title: string; options: Option[] }
  | { kind: 'color' }
  | { kind: 'text'; title: string; value: string; hint?: string; save: (value: string) => void };

const permissionLabel: Record<NotificationSettingsVM['permission'], string> = {
  granted: 'オン',
  default: '通知をオンにする',
  denied: 'ブロックされています',
  unsupported: 'この端末では使えません',
  'needs-install': 'ホーム画面に追加が必要',
};

const familyChangesLabel = { mine: '自分に関係する予定', all: 'すべて', off: 'オフ' } as const;

const hm = (t: TimeHM) => t.replace(/^0/, '');

export default function SettingsScreen({
  vm,
  onChangeProfile,
  onChangeNotifications,
  onEnableNotifications,
  onTestNotification,
  onChangeTheme,
  onChangeTextSize,
  onChangeWeekStart,
  onOpenMembers,
  onOpenActivity,
  onOpenTrash,
  onExport,
  onOpenInstallGuide,
  onRemoveDevice,
  onLogoutDevice,
}: SettingsScreenProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const n = vm.notifications;
  const close = () => setPanel(null);
  const options = (title: string, list: Option[]) =>
    setPanel({ kind: 'options', title, options: list });
  const taken = new Map(vm.takenColors.map((t) => [t.color, t.mark]));
  const themeLabel = { system: '端末に合わせる', light: 'ライト', dark: 'ダーク' }[vm.theme];

  return (
    <>
      <header className="settings-header">
        <div>
          <p>この端末と家族</p>
          <strong>設定</strong>
        </div>
        <span className={`member-text--${vm.me.color}`}>{vm.me.name}</span>
      </header>

      <div className="settings-scroll">
        {n.permission !== 'granted' && (
          <div className="notification-guide">
            <Bell aria-hidden="true" />
            <p>
              <strong>通知はオフです</strong>
              {n.permission === 'needs-install'
                ? 'iPhoneではホーム画面に追加すると通知を使えます。'
                : n.permission === 'denied'
                  ? '端末の設定で、このアプリの通知を許可してください。'
                  : n.permission === 'unsupported'
                    ? 'この端末やブラウザでは通知を使えません。'
                    : '予定の前や、家族が予定を変えたときに知らせます。'}
            </p>
            {n.permission === 'default' && (
              <Button onClick={onEnableNotifications}>通知をオンにする</Button>
            )}
            {n.permission === 'needs-install' && (
              <Button onClick={onOpenInstallGuide}>追加の方法</Button>
            )}
          </div>
        )}

        <section className="settings-section">
          <div className="settings-section-heading">
            <Bell aria-hidden="true" />
            <strong>通知</strong>
          </div>
          <SettingRow
            label="状態"
            onClick={n.permission === 'default' ? onEnableNotifications : undefined}
            value={permissionLabel[n.permission]}
          />
          <SettingRow
            label="時刻ありの予定"
            onClick={() =>
              options(
                '時刻ありの予定の通知（担当のとき）',
                [[], [0], [-10], [-30], [-60], [-1440]].map((v) => ({
                  label: v.length === 0 ? 'なし' : reminderLabel(v[0] as number, false),
                  pressed: JSON.stringify(v) === JSON.stringify(n.timedDefaults),
                  apply: () => onChangeNotifications({ timedDefaults: v }),
                })),
              )
            }
            value={
              n.timedDefaults.length
                ? n.timedDefaults.map((o) => reminderLabel(o, false)).join('・')
                : 'なし'
            }
          />
          <SettingRow
            label="終日の予定"
            onClick={() =>
              options(
                '終日の予定の通知（担当のとき）',
                [[], [-240], [420]].map((v) => ({
                  label: v.length === 0 ? 'なし' : reminderLabel(v[0] as number, true),
                  pressed: JSON.stringify(v) === JSON.stringify(n.allDayDefaults),
                  apply: () => onChangeNotifications({ allDayDefaults: v }),
                })),
              )
            }
            value={
              n.allDayDefaults.length
                ? n.allDayDefaults.map((o) => reminderLabel(o, true)).join('・')
                : 'なし'
            }
          />
          <SettingRow
            label="朝のまとめ"
            onClick={() =>
              options('朝のまとめ', [
                {
                  label: 'オフ',
                  apply: () =>
                    onChangeNotifications({
                      morningDigest: { ...n.morningDigest, enabled: false },
                    }),
                },
                ...['06:00', '07:00', '08:00', '09:00'].map((t) => ({
                  label: hm(t),
                  pressed: n.morningDigest.enabled && n.morningDigest.time === t,
                  apply: () => onChangeNotifications({ morningDigest: { enabled: true, time: t } }),
                })),
              ])
            }
            value={n.morningDigest.enabled ? hm(n.morningDigest.time) : 'オフ'}
          />
          <SettingRow
            label="前夜の予告"
            onClick={() =>
              options('前夜の予告', [
                {
                  label: 'オフ',
                  apply: () =>
                    onChangeNotifications({
                      eveningPreview: { ...n.eveningPreview, enabled: false },
                    }),
                },
                ...['20:00', '21:00', '22:00'].map((t) => ({
                  label: hm(t),
                  pressed: n.eveningPreview.enabled && n.eveningPreview.time === t,
                  apply: () =>
                    onChangeNotifications({ eveningPreview: { enabled: true, time: t } }),
                })),
              ])
            }
            value={n.eveningPreview.enabled ? hm(n.eveningPreview.time) : 'オフ'}
          />
          <SettingRow
            label="家族の変更"
            onClick={() =>
              options(
                '家族の変更',
                (['mine', 'all', 'off'] as const).map((v) => ({
                  label: familyChangesLabel[v],
                  pressed: n.familyChanges === v,
                  apply: () => onChangeNotifications({ familyChanges: v }),
                })),
              )
            }
            value={familyChangesLabel[n.familyChanges]}
          />
          <SettingRow
            label="静かな時間"
            onClick={() =>
              options('静かな時間', [
                ...[
                  ['22:00', '07:00'],
                  ['21:00', '08:00'],
                  ['23:00', '06:00'],
                ].map(([from, to]) => ({
                  label: `${hm(from as string)}–${hm(to as string)}`,
                  pressed:
                    n.quietHours.enabled && n.quietHours.from === from && n.quietHours.to === to,
                  apply: () =>
                    onChangeNotifications({
                      quietHours: { enabled: true, from: from as string, to: to as string },
                    }),
                })),
                {
                  label: '使わない',
                  pressed: !n.quietHours.enabled,
                  apply: () =>
                    onChangeNotifications({ quietHours: { ...n.quietHours, enabled: false } }),
                },
              ])
            }
            value={
              n.quietHours.enabled ? `${hm(n.quietHours.from)}–${hm(n.quietHours.to)}` : '使わない'
            }
          />
          <SettingRow
            label="ロック画面に予定名"
            onClick={() =>
              options('ロック画面に予定名', [
                {
                  label: '予定名を表示',
                  pressed: n.showDetailsOnLockScreen,
                  apply: () => onChangeNotifications({ showDetailsOnLockScreen: true }),
                },
                {
                  label: '「予定あり」と表示',
                  pressed: !n.showDetailsOnLockScreen,
                  apply: () => onChangeNotifications({ showDetailsOnLockScreen: false }),
                },
              ])
            }
            value={n.showDetailsOnLockScreen ? '表示する' : '表示しない'}
          />
          <SettingRow label="テスト通知" onClick={onTestNotification} value="送る" />
          {vm.devices.map((device) => (
            <SettingRow
              danger
              key={device.id}
              label={`${device.label}${device.isThisDevice ? '（この端末）' : ''} · ${device.lastUsedLabel}`}
              onClick={() => onRemoveDevice(device.id)}
              value="通知を止める"
            />
          ))}
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Type aria-hidden="true" />
            <strong>表示</strong>
          </div>
          <SettingRow
            label="文字の大きさ"
            onClick={() =>
              options('文字の大きさ', [
                {
                  label: '標準',
                  pressed: vm.textSize === 'standard',
                  apply: () => onChangeTextSize('standard'),
                },
                {
                  label: '大きめ',
                  pressed: vm.textSize === 'large',
                  apply: () => onChangeTextSize('large'),
                },
              ])
            }
            value={vm.textSize === 'large' ? '大きめ' : '標準'}
          />
          <SettingRow
            label="テーマ"
            onClick={() =>
              options('テーマ', [
                {
                  label: '端末に合わせる',
                  pressed: vm.theme === 'system',
                  apply: () => onChangeTheme('system'),
                },
                {
                  label: 'ライト',
                  pressed: vm.theme === 'light',
                  apply: () => onChangeTheme('light'),
                },
                {
                  label: 'ダーク',
                  pressed: vm.theme === 'dark',
                  apply: () => onChangeTheme('dark'),
                },
              ])
            }
            value={themeLabel}
          />
          <SettingRow
            label="週の始まり"
            onClick={() =>
              options('週の始まり', [
                { label: '日曜日', pressed: vm.weekStart === 0, apply: () => onChangeWeekStart(0) },
                { label: '月曜日', pressed: vm.weekStart === 1, apply: () => onChangeWeekStart(1) },
              ])
            }
            value={vm.weekStart === 0 ? '日曜日' : '月曜日'}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <User aria-hidden="true" />
            <strong>自分</strong>
          </div>
          <SettingRow
            label="名前"
            onClick={() =>
              setPanel({
                kind: 'text',
                title: '名前',
                value: vm.me.name,
                hint: '20 文字まで',
                save: (v) => onChangeProfile({ name: v }),
              })
            }
            value={vm.me.name}
          />
          <SettingRow
            label="略称"
            onClick={() =>
              setPanel({
                kind: 'text',
                title: '略称',
                value: vm.me.mark,
                hint: '1 文字（糸のラベル）',
                save: (v) => onChangeProfile({ mark: v }),
              })
            }
            value={vm.me.mark}
          />
          <SettingRow
            label="色"
            onClick={() => setPanel({ kind: 'color' })}
            value={COLOR_LABELS[vm.me.color]}
          />
          <SettingRow
            label="呼び名"
            onClick={() =>
              setPanel({
                kind: 'text',
                title: '呼び名（一言入力で自分を指す言葉）',
                value: vm.aliases.join('、'),
                hint: '「、」で区切る（10 個まで）',
                save: (v) =>
                  onChangeProfile({
                    aliases: v
                      .split(/[、,]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
              })
            }
            value={vm.aliases.length ? vm.aliases.join('・') : 'なし'}
          />
        </section>

        {vm.isAdmin && (
          <section className="settings-section">
            <div className="settings-section-heading">
              <Users aria-hidden="true" />
              <strong>家族の管理（管理者だけ）</strong>
            </div>
            <SettingRow
              label="家族のメンバー"
              onClick={onOpenMembers}
              value={`${vm.members.filter((m) => !m.disabled).length}人`}
            />
          </section>
        )}

        <section className="settings-section">
          <div className="settings-section-heading">
            <Database aria-hidden="true" />
            <strong>データ</strong>
          </div>
          <SettingRow label="変更の履歴" onClick={onOpenActivity} />
          <SettingRow label="ゴミ箱" onClick={onOpenTrash} />
          <SettingRow
            label="予定を書き出す"
            onClick={() =>
              options('予定を書き出す', [
                { label: 'JSON（バックアップ用）', apply: () => onExport('json') },
                { label: 'ICS（カレンダーに取り込む）', apply: () => onExport('ics') },
              ])
            }
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Smartphone aria-hidden="true" />
            <strong>この端末</strong>
          </div>
          <SettingRow
            label="ホーム画面に追加"
            onClick={onOpenInstallGuide}
            value={vm.install.installed ? 'ホーム画面から開いています' : 'ガイドを見る'}
          />
          <SettingRow danger label="この端末からログアウト" onClick={onLogoutDevice} />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Info aria-hidden="true" />
            <strong>アプリ情報</strong>
          </div>
          <SettingRow label="バージョン" value={vm.appVersion} />
        </section>
      </div>

      {panel && (
        <div className="sheet-backdrop">
          <section
            aria-label="設定を選ぶ"
            aria-modal="true"
            className="bottom-sheet setting-picker"
            role="dialog"
          >
            <div className="sheet-title">
              <strong>
                {panel.kind === 'color'
                  ? '色を選ぶ'
                  : panel.kind === 'text'
                    ? panel.title
                    : panel.title}
              </strong>
              <Button onClick={close}>閉じる</Button>
            </div>
            {panel.kind === 'color' ? (
              <div className="thread-color-picker">
                {(Object.keys(COLOR_LABELS) as MemberColor[]).map((color) => (
                  <Button
                    aria-pressed={vm.me.color === color}
                    className={`thread-color thread-color--${color}`}
                    disabled={taken.has(color) && color !== vm.me.color}
                    key={color}
                    onClick={() => {
                      onChangeProfile({ color });
                      close();
                    }}
                  >
                    <i />
                    <span>{COLOR_LABELS[color]}</span>
                    {taken.has(color) && <small>{taken.get(color)}が使用中</small>}
                  </Button>
                ))}
              </div>
            ) : panel.kind === 'text' ? (
              <TextPanel panel={panel} onDone={close} />
            ) : (
              <div className="setting-picker-options">
                {panel.options.map((option) => (
                  <Button
                    aria-pressed={option.pressed}
                    key={option.label}
                    onClick={() => {
                      option.apply();
                      close();
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function TextPanel({
  panel,
  onDone,
}: {
  panel: Extract<Panel, { kind: 'text' }>;
  onDone: () => void;
}) {
  const [value, setValue] = useState(panel.value);
  return (
    <form
      className="setting-text-form"
      onSubmit={(e) => {
        e.preventDefault();
        panel.save(value.trim());
        onDone();
      }}
    >
      <Input aria-label={panel.title} onChange={(e) => setValue(e.target.value)} value={value} />
      {panel.hint && <p>{panel.hint}</p>}
      <Button type="submit" variant="accent">
        保存
      </Button>
    </form>
  );
}
