import { useState } from "react"
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  Clock3,
  Database,
  Settings,
  Smartphone,
  Type,
  User,
  Users,
} from "lucide-react"
import { Button } from "../primitives/Controls"

export type SettingsVariant = "normal" | "notifications-off" | "large"

type SettingsScreenProps = {
  variant: SettingsVariant
  onOpenComposer: () => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
  onTextSizeChange: (value: "標準" | "大きめ") => void
  onThemeChange: (value: "端末に合わせる" | "ライト" | "ダーク") => void
  onOpenTrash: () => void
  onOpenInstallGuide: () => void
}

type SettingRowProps = {
  label: string
  value?: string
  danger?: boolean
  onClick?: () => void
}

function SettingRow({ label, value, danger, onClick }: SettingRowProps) {
  return (
    <Button
      className={`setting-row ${danger ? "setting-row--danger" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span>
        {value && <strong>{value}</strong>}
        <ChevronRight aria-hidden="true" />
      </span>
    </Button>
  )
}

const PANEL_OPTIONS: Record<string, string[]> = {
  morning: ["オフ", "7:00", "8:00", "9:00"],
  changes: ["すべて", "追加と変更", "重要な変更だけ", "オフ"],
  quiet: ["22:00–7:00", "21:00–8:00", "使わない"],
  lock: ["予定名を表示", "「予定あり」と表示"],
  text: ["標準", "大きめ"],
  theme: ["端末に合わせる", "ライト", "ダーク"],
  week: ["日曜日", "月曜日"],
  nickname: ["名前で呼ぶ", "略称で呼ぶ"],
}

export default function SettingsScreen({
  variant,
  onOpenComposer,
  onNavigate,
  onTextSizeChange,
  onThemeChange,
  onOpenTrash,
  onOpenInstallGuide,
}: SettingsScreenProps) {
  const [openPanel, setOpenPanel] = useState<string>()
  const [textSize, setTextSize] = useState(
    variant === "large" ? "大きめ" : "標準",
  )
  const [theme, setTheme] = useState("端末に合わせる")
  const [weekStart, setWeekStart] = useState("日曜日")
  const [notificationsOn, setNotificationsOn] = useState(
    variant !== "notifications-off",
  )
  const [selectedColor, setSelectedColor] = useState("yamabuki")
  const [testSent, setTestSent] = useState(false)

  const selectPanelValue = (value: string) => {
    if (openPanel === "text") {
      setTextSize(value)
      onTextSizeChange(value as "標準" | "大きめ")
    }
    if (openPanel === "theme") {
      setTheme(value)
      onThemeChange(value as "端末に合わせる" | "ライト" | "ダーク")
    }
    if (openPanel === "week") setWeekStart(value)
    setOpenPanel(undefined)
  }

  return (
    <main className="app-shell settings-screen">
      <header className="settings-header">
        <div>
          <p>この端末と家族</p>
          <strong>設定</strong>
        </div>
        <span>はると</span>
      </header>

      <div className="settings-scroll">
        {!notificationsOn && (
          <div className="notification-guide">
            <Bell aria-hidden="true" />
            <p>
              <strong>通知はオフです</strong>
              iPhoneではホーム画面に追加すると通知を使えます。
            </p>
            <Button onClick={() => setNotificationsOn(true)}>
              通知をオンにする
            </Button>
          </div>
        )}

        <section className="settings-section">
          <div className="settings-section-heading">
            <Bell aria-hidden="true" />
            <strong>通知</strong>
          </div>
          <SettingRow
            label="状態"
            onClick={() => setNotificationsOn((on) => !on)}
            value={notificationsOn ? "オン" : "通知をオンにする"}
          />
          <SettingRow
            label="朝のまとめ"
            onClick={() => setOpenPanel("morning")}
            value="7:00"
          />
          <SettingRow
            label="家族の変更"
            onClick={() => setOpenPanel("changes")}
            value="すべて"
          />
          <SettingRow
            label="静かな時間"
            onClick={() => setOpenPanel("quiet")}
            value="22:00–7:00"
          />
          <SettingRow
            label="ロック画面に予定名"
            onClick={() => setOpenPanel("lock")}
            value="表示する"
          />
          <SettingRow
            label="テスト通知"
            onClick={() => setTestSent(true)}
            value={testSent ? "送信しました" : "送る"}
          />
          <SettingRow label="通知を受け取る端末" value="このiPhone" />
          <SettingRow danger label="この端末の通知" value="通知を止める" />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Type aria-hidden="true" />
            <strong>表示</strong>
          </div>
          <SettingRow
            label="文字の大きさ"
            onClick={() => setOpenPanel("text")}
            value={textSize}
          />
          <SettingRow
            label="テーマ"
            onClick={() => setOpenPanel("theme")}
            value={theme}
          />
          <SettingRow
            label="週の始まり"
            onClick={() => setOpenPanel("week")}
            value={weekStart}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <User aria-hidden="true" />
            <strong>自分</strong>
          </div>
          <SettingRow label="名前" value="はると" />
          <SettingRow label="略称" value="は" />
          <SettingRow
            label="色"
            onClick={() => setOpenPanel("color")}
            value="山吹"
          />
          <SettingRow
            label="呼び名"
            onClick={() => setOpenPanel("nickname")}
            value="名前で呼ぶ"
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Users aria-hidden="true" />
            <strong>家族の管理（管理者だけ）</strong>
          </div>
          <SettingRow label="家族のメンバー" value="4人" />
          <SettingRow label="招待と権限" value="管理者" />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Database aria-hidden="true" />
            <strong>データ</strong>
          </div>
          <SettingRow label="変更の履歴" />
          <SettingRow label="ゴミ箱" onClick={onOpenTrash} value="2件" />
          <SettingRow label="予定を書き出す" />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <Smartphone aria-hidden="true" />
            <strong>この端末</strong>
          </div>
          <SettingRow
            label="ホーム画面に追加"
            onClick={onOpenInstallGuide}
            value="ガイドを見る"
          />
          <SettingRow danger label="この端末からログアウト" />
        </section>
      </div>

      <div className="bottom-area">
        <Button className="quick-add-trigger" onClick={onOpenComposer}>
          <b>＋</b>
          <span>予定を書く</span>
          <small>例: 土曜10時 父 ゴルフ</small>
        </Button>
        <nav className="bottom-nav" aria-label="メイン">
          {[
            { label: "これから", icon: Clock3, view: "upcoming" as const },
            { label: "月", icon: CalendarDays, view: "month" as const },
            {
              label: "空き",
              icon: CalendarRange,
              view: "availability" as const,
            },
            { label: "設定", icon: Settings, view: "settings" as const },
          ].map((item, index) => {
            const Icon = item.icon
            return (
              <Button
                aria-current={index === 3 ? "page" : undefined}
                key={item.label}
                onClick={() => onNavigate(item.view)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Button>
            )
          })}
        </nav>
      </div>

      {openPanel && (
        <div className="sheet-backdrop">
          <section
            className="bottom-sheet setting-picker"
            aria-modal="true"
            role="dialog"
          >
            <div className="sheet-title">
              <strong>
                {openPanel === "color" ? "色を選ぶ" : "設定を選ぶ"}
              </strong>
              <Button onClick={() => setOpenPanel(undefined)}>閉じる</Button>
            </div>
            {openPanel === "color" ? (
              <div className="thread-color-picker">
                {[
                  { id: "yamabuki", label: "山吹", used: "は" },
                  { id: "wakakusa", label: "若草" },
                  { id: "wakatake", label: "若竹", used: "さ" },
                  { id: "asagi", label: "浅葱", used: "父" },
                  { id: "fuji", label: "藤" },
                  { id: "momo", label: "桃", used: "母" },
                  { id: "ruri", label: "瑠璃" },
                  { id: "kaki", label: "柿" },
                ].map((color) => (
                  <Button
                    aria-pressed={selectedColor === color.id}
                    className={`thread-color thread-color--${color.id}`}
                    disabled={Boolean(color.used) && color.id !== selectedColor}
                    key={color.id}
                    onClick={() => {
                      setSelectedColor(color.id)
                      setOpenPanel(undefined)
                    }}
                  >
                    <i />
                    <span>{color.label}</span>
                    {color.used && <small>{color.used}が使用中</small>}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="setting-picker-options">
                {(PANEL_OPTIONS[openPanel] ?? ["オン", "オフ"]).map(
                  (option) => (
                    <Button
                      key={option}
                      onClick={() => selectPanelValue(option)}
                    >
                      {option}
                    </Button>
                  ),
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
