import { CalendarDays, CalendarRange, Clock3, Settings } from "lucide-react"
import { Button } from "./Controls"

type View = "upcoming" | "month" | "availability" | "settings"

export default function AppBottomArea({
  active,
  hint = "例: 土曜10時 父 ゴルフ",
  onNavigate,
  onWrite,
}: {
  active?: View
  hint?: string
  onNavigate: (view: View) => void
  onWrite: () => void
}) {
  return (
    <div className="bottom-area">
      <Button className="quick-add-trigger" onClick={onWrite}>
        <b>＋</b>
        <span>予定を書く</span>
        <small>{hint}</small>
      </Button>
      <nav className="bottom-nav" aria-label="メイン">
        {[
          { label: "これから", icon: Clock3, view: "upcoming" as const },
          { label: "月", icon: CalendarDays, view: "month" as const },
          { label: "空き", icon: CalendarRange, view: "availability" as const },
          { label: "設定", icon: Settings, view: "settings" as const },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Button
              aria-current={active === item.view ? "page" : undefined}
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
  )
}
