import { useState } from "react"
import { Button } from "../primitives/Controls"

type OnboardingScreenProps = {
  step: 1 | 2
  onNext: () => void
  onStart: () => void
}

const COLORS = [
  { id: "yamabuki", label: "山吹" },
  { id: "wakakusa", label: "若草" },
  { id: "wakatake", label: "若竹" },
  { id: "asagi", label: "浅葱" },
  { id: "fuji", label: "藤" },
  { id: "momo", label: "桃" },
  { id: "ruri", label: "瑠璃" },
  { id: "kaki", label: "柿" },
]

export default function OnboardingScreen({
  step,
  onNext,
  onStart,
}: OnboardingScreenProps) {
  const [selectedColor, setSelectedColor] = useState<string>()

  return (
    <main className="app-shell onboarding-screen">
      <div className="onboarding-progress" aria-label={`${step}/2`}>
        <i className={step >= 1 ? "is-active" : ""} />
        <i className={step >= 2 ? "is-active" : ""} />
      </div>
      {step === 1 ? (
        <section className="onboarding-content">
          <p className="onboarding-kicker">いとへようこそ</p>
          <p className="onboarding-title">
            こんにちは、
            <br />
            はるとさん。
          </p>
          <p className="onboarding-lead">あなたの色を選んでください</p>
          <div className="onboarding-colors">
            {COLORS.map((color) => (
              <Button
                aria-pressed={selectedColor === color.id}
                className={`onboarding-color onboarding-color--${color.id}`}
                key={color.id}
                onClick={() => setSelectedColor(color.id)}
              >
                <i />
                <span>{color.label}</span>
                {selectedColor === color.id && <small>この色にする</small>}
              </Button>
            ))}
          </div>
          <Button
            className="onboarding-next"
            disabled={!selectedColor}
            onClick={onNext}
            variant="accent"
          >
            次へ
          </Button>
        </section>
      ) : (
        <section className="onboarding-content onboarding-share">
          <div className="onboarding-thread-illustration" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <span />
          </div>
          <p className="onboarding-title">
            下の入力欄に
            <br />
            書くだけで、
          </p>
          <p className="onboarding-lead">家族みんなに共有されます。</p>
          <div className="onboarding-input-example">
            <b>＋</b>
            <span>土曜10時 父 ゴルフ</span>
          </div>
          <p className="onboarding-note">
            ホーム画面への追加と通知は、あとでホームの案内から設定できます。
          </p>
          <Button
            className="onboarding-next"
            onClick={onStart}
            variant="accent"
          >
            はじめる
          </Button>
        </section>
      )}
    </main>
  )
}
