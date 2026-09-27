import { AppWindow, ArrowLeft, Download, Share, SquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../primitives/Controls';
import type { InstallGuideScreenProps } from '../types';

/** S-12 ホーム画面への追加ガイド（iOS／Android 別の手順。付録B） */
export default function InstallGuideScreen({
  platform: detected,
  installed,
  canPrompt,
  onPromptInstall,
  onBack,
}: InstallGuideScreenProps) {
  const [platform, setPlatform] = useState<'iphone' | 'android'>(
    detected === 'android' ? 'android' : 'iphone',
  );

  return (
    <main className="app-shell install-guide-screen">
      <header className="secondary-header">
        <Button aria-label="戻る" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>通知を受け取る準備</p>
          <strong>ホーム画面に追加</strong>
        </div>
        <span />
      </header>
      {/* biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と flex の差を避けて見た目を変えない（role=group で同じ意味） */}
      <div className="platform-toggle" aria-label="端末を選ぶ" role="group">
        <Button aria-pressed={platform === 'iphone'} onClick={() => setPlatform('iphone')}>
          iPhone
        </Button>
        <Button aria-pressed={platform === 'android'} onClick={() => setPlatform('android')}>
          Android
        </Button>
      </div>
      <section className="install-guide-content">
        {installed && (
          <p className="install-intro">この端末では、もうホーム画面から開いています。</p>
        )}
        {platform === 'iphone' ? (
          <>
            <p className="install-intro">Safariで開いて、3つの手順で追加できます。</p>
            <div className="install-steps">
              <div>
                <strong>1</strong>
                <Share aria-hidden="true" />
                <p>
                  画面下の
                  <br />
                  <b>共有ボタン</b>を押す
                </p>
              </div>
              <div>
                <strong>2</strong>
                <SquarePlus aria-hidden="true" />
                <p>
                  <b>ホーム画面に追加</b>
                  <br />
                  を選ぶ
                </p>
              </div>
              <div>
                <strong>3</strong>
                <AppWindow aria-hidden="true" />
                <p>
                  ホーム画面の
                  <br />
                  <b>「いと」アイコン</b>から開く
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="android-install">
            <Download aria-hidden="true" />
            <p className="onboarding-title">
              「いと」を
              <br />
              インストール
            </p>
            <p>アプリとして開けるようになり、通知も受け取れます。</p>
            <Button disabled={!canPrompt} onClick={onPromptInstall} variant="accent">
              インストール
            </Button>
            <small>
              ボタンが使えない場合は、ブラウザのメニューから
              「アプリをインストール」を選んでください。
            </small>
          </div>
        )}
      </section>
    </main>
  );
}
