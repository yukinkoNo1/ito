import { useState } from "react"
import { AppWindow, ArrowLeft, Download, Share, SquarePlus } from "lucide-react"
import { Button } from "../primitives/Controls"

type InstallGuideScreenProps = {
  initialPlatform: "iphone" | "android"
  onClose: () => void
}

export default function InstallGuideScreen({
  initialPlatform,
  onClose,
}: InstallGuideScreenProps) {
  const [platform, setPlatform] = useState(initialPlatform)

  return (
    <main className="app-shell install-guide-screen">
      <header className="secondary-header">
        <Button aria-label="閉じる" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>通知を受け取る準備</p>
          <strong>ホーム画面に追加</strong>
        </div>
        <span />
      </header>
      <div className="platform-toggle" aria-label="端末を選ぶ">
        <Button
          aria-pressed={platform === "iphone"}
          onClick={() => setPlatform("iphone")}
        >
          iPhone
        </Button>
        <Button
          aria-pressed={platform === "android"}
          onClick={() => setPlatform("android")}
        >
          Android
        </Button>
      </div>
      <section className="install-guide-content">
        {platform === "iphone" ? (
          <>
            <p className="install-intro">
              Safariで開いて、3つの手順で追加できます。
            </p>
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
            <Button variant="accent">インストール</Button>
            <small>
              ボタンが使えない場合は、ブラウザのメニューから
              「アプリをインストール」を選んでください。
            </small>
          </div>
        )}
      </section>
    </main>
  )
}
