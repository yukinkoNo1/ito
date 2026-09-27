import { addDays } from '@ito/core/jst';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { eventToDraft } from '../../viewmodels/detail';
import {
  buildFlowScreen,
  buildMonthScreen,
  COMPOSER_HINT,
  FLOW_WINDOW_DAYS,
  toSyncVM,
} from '../../viewmodels/screens';
import {
  MOCK_FRESH_SINCE,
  MOCK_ME_ID,
  MOCK_NOW,
  MOCK_TODAY,
  mockActivity,
  mockAdminMembers,
  mockComposer,
  mockConflict,
  mockContext,
  mockDetail,
  mockEvents,
  mockEvents8,
  mockFreeTime,
  mockMembers8,
  mockMemberVMs,
  mockOccurrence,
  mockQuickDates,
  mockQuickTimes,
  mockSearch,
  mockSettings,
  mockTrash,
} from '../mock';
import AppShell from '../primitives/AppShell';
import { Button } from '../primitives/Controls';
import AvailabilityScreen from '../screens/AvailabilityScreen';
import HistoryScreen from '../screens/HistoryScreen';
import InstallGuideScreen from '../screens/InstallGuideScreen';
import MembersAdminScreen from '../screens/MembersAdminScreen';
import MonthScreen from '../screens/MonthScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import SearchScreen from '../screens/SearchScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TrashScreen from '../screens/TrashScreen';
import UpcomingScreen from '../screens/UpcomingScreen';
import EventComposerSheet from '../sheets/EventComposerSheet';
import EventDetailSheet, {
  ConflictSheet,
  FieldEditSheet,
  RecurrenceScopeDialog,
} from '../sheets/EventDetailSheet';
import type { FlowScreenProps, SyncVM, TabId, ToastVM } from '../types';
import { SCENARIOS, type Scenario } from './scenarios';

/**
 * 状態のギャラリー（/__gallery。開発と E2E 用のビルドにだけ入る。RUNBOOK 3.・§24 D31）。
 * ?s=<状態>&theme=dark&bare=1（bare は枠なしで、本番の画面とスクリーンショットを比べるため）
 */

const noop = () => {};
const SYNCED = toSyncVM('synced', MOCK_NOW, 0);

function isScenario(s: string | null): s is Scenario {
  return SCENARIOS.some(([key]) => key === s);
}

function Shell({
  current,
  screen,
  sync = SYNCED,
  toast = null,
  overlay,
  children,
}: {
  current: TabId;
  screen?: string;
  sync?: SyncVM;
  toast?: ToastVM | null;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell
      composerHint={COMPOSER_HINT}
      current={current}
      onNavigate={noop}
      onOpenComposer={noop}
      onRetrySync={noop}
      onToastAction={noop}
      onToastDismiss={noop}
      overlay={overlay}
      screen={screen}
      sync={sync}
      toast={toast}
    >
      {children}
    </AppShell>
  );
}

const flowHandlers: Pick<
  FlowScreenProps,
  | 'onPickExample'
  | 'onSetFilter'
  | 'onJumpToFresh'
  | 'onJumpToDate'
  | 'onPrevWeek'
  | 'onNextWeek'
  | 'onOpenOccurrence'
  | 'onComposeOnDate'
  | 'onReachStart'
  | 'onReachEnd'
  | 'onJumpToday'
  | 'onNoticeAction'
  | 'onNoticeDismiss'
  | 'onOpenActivity'
  | 'onOpenSearch'
> = {
  onPickExample: noop,
  onSetFilter: noop,
  onJumpToFresh: noop,
  onJumpToDate: noop,
  onPrevWeek: noop,
  onNextWeek: noop,
  onOpenOccurrence: noop,
  onComposeOnDate: noop,
  onReachStart: noop,
  onReachEnd: noop,
  onJumpToday: noop,
  onNoticeAction: noop,
  onNoticeDismiss: noop,
  onOpenActivity: noop,
  onOpenSearch: noop,
};

/** 本番のこれから（FlowContainer）と同じ組み立て */
function Flow({ scenario, overlay }: { scenario: Scenario; overlay?: ReactNode }) {
  const eight = scenario === 'flow-8';
  const events = scenario === 'flow-empty' ? [] : eight ? mockEvents8() : mockEvents();
  const ctx = mockContext({
    ...(scenario === 'flow-fresh' ? { freshSince: MOCK_FRESH_SINCE } : {}),
    ...(eight ? { members: mockMembers8 } : {}),
  });
  const sync =
    scenario === 'flow-offline'
      ? toSyncVM('offline', MOCK_NOW - 12 * 60_000, 2)
      : scenario === 'flow-blocked'
        ? toSyncVM('error', MOCK_NOW - 12 * 60_000, 1, { kind: 'client_outdated' })
        : SYNCED;
  const data = buildFlowScreen({
    events,
    ctx,
    filter: scenario === 'flow-self' ? [MOCK_ME_ID] : null,
    from: addDays(MOCK_TODAY, -1),
    to: addDays(MOCK_TODAY, FLOW_WINDOW_DAYS),
    selectedDate: MOCK_TODAY,
    weekStart: 0,
    unreadActivity: scenario === 'flow-fresh' ? 2 : 0,
    notice:
      scenario === 'flow-first'
        ? {
            kind: 'install',
            message: 'ホーム画面に追加すると、アプリのようにすぐ開けます',
            actionLabel: '追加の方法',
          }
        : null,
    showBackToToday: scenario === 'flow-away',
  });
  const toast: ToastVM | null =
    scenario === 'flow-toast'
      ? { id: 't1', kind: 'undo', message: '予定を削除しました', actionLabel: '元に戻す' }
      : null;
  return (
    <Shell current="flow" overlay={overlay} sync={sync} toast={toast}>
      <UpcomingScreen {...data} {...flowHandlers} sync={sync} />
    </Shell>
  );
}

function Month({ scenario }: { scenario: Scenario }) {
  const next = scenario === 'month-next';
  const data = buildMonthScreen({
    events: mockEvents(),
    ctx: mockContext(),
    year: 2030,
    month: next ? 10 : 9,
    selectedDate: next ? '2030-10-12' : MOCK_TODAY,
    weekStart: scenario === 'month-monday' ? 1 : 0,
  });
  return (
    <Shell current="month" screen="month-screen">
      <MonthScreen
        {...data}
        onComposeOnDate={noop}
        onNextMonth={noop}
        onOpenOccurrence={noop}
        onPickMonth={noop}
        onPrevMonth={noop}
        onSelectDate={noop}
        onToday={noop}
      />
    </Shell>
  );
}

function Composer({ scenario }: { scenario: Scenario }) {
  const base = mockComposer({}, scenario === 'edit' ? 'dentist' : undefined);
  const chips = base.draft
    ? {
        ...base.draft,
        title: '歯医者',
        allDay: false,
        startDate: '2030-10-01',
        startTime: '15:00',
        memberIds: [mockAdminMembers[2]?.id ?? MOCK_ME_ID],
      }
    : null;
  const vm =
    scenario === 'write-chips' || scenario === 'write-detail'
      ? mockComposer({
          text: '歯医者',
          draft: chips,
          mode: scenario === 'write-detail' ? 'detail' : 'quick',
          saveLabel: '10/1(火) 15:00 に保存',
        })
      : scenario === 'write-ambiguous'
        ? mockComposer({
            text: '来週の土曜 家族で買い物',
            parse: 'done',
            source: 'ai',
            draft: chips
              ? {
                  ...chips,
                  title: '家族で買い物',
                  forEveryone: true,
                  memberIds: [],
                  startDate: '2030-10-05',
                  startTime: '10:00',
                }
              : null,
            ambiguities: [
              {
                field: 'date',
                question: '「来週の土曜」はどちら？',
                options: [
                  { label: '10/5(土)', patch: { startDate: '2030-10-05' } },
                  { label: '10/12(土)', patch: { startDate: '2030-10-12' } },
                ],
                chosen: 0,
              },
            ],
            overlaps: ['10/5(土) は「運動会」と重なっています'],
            saveLabel: '10/5(土) 10:00 に保存',
          })
        : scenario === 'write-error'
          ? mockComposer({ text: 'ええと', parse: 'failed', error: null })
          : base;
  return (
    <Flow
      overlay={
        <EventComposerSheet
          members={mockMemberVMs}
          onChangeDraft={noop}
          onChooseAmbiguity={noop}
          onClose={noop}
          onPickSuggestion={noop}
          onSave={noop}
          onSetMode={noop}
          onSubmitText={noop}
          onTextChange={noop}
          online={scenario !== 'write-offline'}
          open
          vm={vm}
        />
      }
      scenario="flow"
    />
  );
}

function Detail({ scenario }: { scenario: Scenario }) {
  const key =
    scenario === 'detail-multiday'
      ? 'trip'
      : scenario === 'detail-private'
        ? 'saki-private'
        : 'dentist';
  const detail = mockDetail(key);
  const shown =
    scenario === 'detail-conflict'
      ? { ...detail, occ: { ...detail.occ, sync: 'conflict' as const } }
      : detail;
  const conflict = mockConflict();
  const draft = eventToDraft(mockOccurrence('dentist').event);
  return (
    <Flow
      overlay={
        <EventDetailSheet
          detail={shown}
          members={mockMemberVMs}
          onChangeReminders={noop}
          onClose={noop}
          onDelete={noop}
          onDuplicate={noop}
          onEdit={noop}
          onEditField={noop}
          onOpenMap={noop}
          onResolveConflict={noop}
        >
          <FieldEditSheet
            canSave
            draft={{ ...draft, startTime: '17:00', endTime: '17:30' }}
            field="date"
            members={mockMemberVMs}
            onChangeDraft={noop}
            onClose={noop}
            onSave={noop}
            open={scenario === 'detail-field'}
            quickDates={mockQuickDates}
            quickTimes={mockQuickTimes}
            saveLabel="9/30(月) 17:00 に変更"
          />
          <ConflictSheet
            members={mockMemberVMs}
            mine={conflict.mine}
            onClose={noop}
            onKeepBoth={noop}
            onKeepMine={noop}
            onKeepTheirs={noop}
            open={scenario === 'detail-conflict'}
            theirs={conflict.theirs}
            deleted={null}
            theirsByName="お母さん"
          />
          <RecurrenceScopeDialog
            action="delete"
            lost={{ following: 2, all: 0 }}
            offline={false}
            onCancel={noop}
            onChoose={noop}
            open={scenario === 'detail-scope'}
          />
        </EventDetailSheet>
      }
      scenario="flow"
    />
  );
}

function Screen({ scenario }: { scenario: Scenario }) {
  if (scenario.startsWith('flow')) return <Flow scenario={scenario} />;
  if (scenario.startsWith('month')) return <Month scenario={scenario} />;
  if (scenario.startsWith('write') || scenario === 'edit') return <Composer scenario={scenario} />;
  if (scenario.startsWith('detail')) return <Detail scenario={scenario} />;
  if (scenario.startsWith('free')) {
    return (
      <Shell current="free">
        <AvailabilityScreen
          members={mockMemberVMs}
          onChangeMinDuration={noop}
          onChangePreset={noop}
          onNextRange={noop}
          onPickSlot={noop}
          onPrevRange={noop}
          onToggleMember={noop}
          vm={mockFreeTime(scenario === 'free-empty' ? 'empty' : 'found')}
        />
      </Shell>
    );
  }
  if (scenario.startsWith('settings')) {
    const vm = mockSettings(
      scenario === 'settings-off'
        ? { notifications: { ...mockSettings().notifications, permission: 'default' } }
        : scenario === 'settings-large'
          ? { textSize: 'large' }
          : {},
    );
    return (
      <Shell current="settings">
        <SettingsScreen
          onChangeNotifications={noop}
          onChangeProfile={noop}
          onChangeTextSize={noop}
          onChangeTheme={noop}
          onChangeWeekStart={noop}
          onEnableNotifications={noop}
          onExport={noop}
          onLogoutDevice={noop}
          onOpenActivity={noop}
          onOpenInstallGuide={noop}
          onOpenMembers={noop}
          onOpenTrash={noop}
          onRemoveDevice={noop}
          onTestNotification={noop}
          vm={vm}
        />
      </Shell>
    );
  }
  if (scenario === 'members') {
    return (
      <Shell current="settings">
        <MembersAdminScreen
          members={mockAdminMembers}
          onAdd={noop}
          onBack={noop}
          onRevokeDevices={noop}
          onUpdate={noop}
        />
      </Shell>
    );
  }
  if (scenario.startsWith('history')) {
    return (
      <Shell current="flow">
        <HistoryScreen
          hasMore={false}
          items={mockActivity(scenario === 'history-read')}
          status="ready"
          members={mockMemberVMs}
          onBack={noop}
          onLoadMore={noop}
          onOpenEvent={noop}
        />
      </Shell>
    );
  }
  if (scenario.startsWith('trash')) {
    return (
      <Shell current="settings">
        <TrashScreen
          items={scenario === 'trash-empty' ? [] : mockTrash()}
          onBack={noop}
          onRestore={noop}
          status="ready"
        />
      </Shell>
    );
  }
  if (scenario.startsWith('search')) {
    const query =
      scenario === 'search-results' ? '歯医者' : scenario === 'search-empty' ? '温泉' : '';
    return (
      <Shell current="flow">
        <SearchScreen
          filterMemberIds={null}
          groups={mockSearch(query)}
          members={mockMemberVMs}
          onBack={noop}
          onOpenOccurrence={noop}
          onQueryChange={noop}
          onSetFilter={noop}
          query={query}
          recentQueries={['歯医者', '運動会']}
        />
      </Shell>
    );
  }
  if (scenario.startsWith('onboarding')) {
    const me = mockMemberVMs.find((m) => m.isMe) ?? mockMemberVMs[0];
    if (!me) return null;
    return (
      <OnboardingScreen
        me={me}
        onNext={noop}
        onPickColor={noop}
        step={scenario === 'onboarding' ? 'color' : 'howto'}
        takenColors={mockAdminMembers
          .filter((m) => !m.isMe)
          .map((m) => ({ color: m.color, mark: m.mark }))}
      />
    );
  }
  return (
    <InstallGuideScreen
      canPrompt={scenario === 'install-android'}
      installed={false}
      onBack={noop}
      onPromptInstall={noop}
      platform={scenario === 'install-android' ? 'android' : 'ios'}
    />
  );
}

function readParams(): {
  scenario: Scenario;
  theme: 'light' | 'dark';
  bare: boolean;
  large: boolean;
} {
  const p = new URLSearchParams(window.location.search);
  const s = p.get('s');
  return {
    scenario: isScenario(s) ? s : 'flow',
    theme: p.get('theme') === 'dark' ? 'dark' : 'light',
    bare: p.get('bare') === '1',
    // large=1 ならどの状態も「大きめ」で描く（E2E の確かめ用）
    large: p.get('large') === '1',
  };
}

export default function Gallery() {
  const initial = useMemo(readParams, []);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [theme, setTheme] = useState<'light' | 'dark'>(initial.theme);
  const large = initial.large || scenario === 'flow-large' || scenario === 'settings-large';

  // 本番と同じく html の属性でテーマと文字の大きさを切り替える（§22）
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = theme;
    if (large) html.dataset.textSize = 'large';
    else delete html.dataset.textSize;
  }, [theme, large]);

  // URL を今の状態に合わせる（読み込み直しても同じ状態）
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('s', scenario);
    p.set('theme', theme);
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [scenario, theme]);

  if (initial.bare) return <Screen scenario={scenario} />;
  return (
    <div className="gallery">
      <div className="gallery-toolbar">
        {/* biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と flex の差を避けて見た目を変えない（role=group で同じ意味） */}
        <div className="gallery-group" aria-label="表示する状態" role="group">
          {SCENARIOS.map(([key, label]) => (
            <Button
              aria-pressed={scenario === key}
              key={key}
              onClick={() => setScenario(key)}
              variant="gallery"
            >
              {label}
            </Button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と flex の差を避けて見た目を変えない（role=group で同じ意味） */}
        <div className="gallery-group" aria-label="配色" role="group">
          {(['light', 'dark'] as const).map((item) => (
            <Button
              aria-pressed={theme === item}
              key={item}
              onClick={() => setTheme(item)}
              variant="gallery"
            >
              {item === 'light' ? 'ライト' : 'ダーク'}
            </Button>
          ))}
        </div>
      </div>
      <div className="device" data-theme={theme}>
        <Screen scenario={scenario} />
      </div>
    </div>
  );
}
