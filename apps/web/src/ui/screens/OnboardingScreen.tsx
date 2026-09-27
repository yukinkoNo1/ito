import { Button } from '../primitives/Controls';
import type { MemberColor, OnboardingScreenProps } from '../types';
import { COLOR_LABELS } from './SettingsScreen';

/** S-11 はじめて（2 画面だけ: 色を選ぶ → 使い方。ホーム画面への追加と通知は、あとでホームの案内から） */
export default function OnboardingScreen({
  step,
  me,
  takenColors,
  onPickColor,
  onNext,
}: OnboardingScreenProps) {
  const taken = new Map(takenColors.map((t) => [t.color, t.mark]));
  return (
    <main className="app-shell onboarding-screen">
      <div className="onboarding-progress" aria-label={`${step === 'color' ? 1 : 2}/2`} role="img">
        <i className="is-active" />
        <i className={step === 'howto' ? 'is-active' : ''} />
      </div>
      {step === 'color' ? (
        <section className="onboarding-content">
          <p className="onboarding-kicker">いとへようこそ</p>
          <p className="onboarding-title">
            こんにちは、
            <br />
            {me.name}さん。
          </p>
          <p className="onboarding-lead">あなたの色を選んでください</p>
          <div className="onboarding-colors">
            {(Object.keys(COLOR_LABELS) as MemberColor[]).map((color) => (
              <Button
                aria-pressed={me.color === color}
                className={`onboarding-color onboarding-color--${color}`}
                disabled={taken.has(color) && color !== me.color}
                key={color}
                onClick={() => onPickColor(color)}
              >
                <i />
                <span>{COLOR_LABELS[color]}</span>
                {me.color === color ? (
                  <small>この色にする</small>
                ) : taken.has(color) ? (
                  <small>{taken.get(color)}が使用中</small>
                ) : null}
              </Button>
            ))}
          </div>
          <Button className="onboarding-next" onClick={onNext} variant="accent">
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
          <Button className="onboarding-next" onClick={onNext} variant="accent">
            はじめる
          </Button>
        </section>
      )}
    </main>
  );
}
