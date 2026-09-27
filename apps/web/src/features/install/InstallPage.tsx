import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  canPromptInstall,
  detectPlatform,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from '../../pwa/install';

/** S-12 ホーム画面に追加ガイド（iOS／Android 別の手順。付録B。素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function InstallPage() {
  const navigate = useNavigate();
  const platform = detectPlatform();
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), []);
  const installed = isStandalone();
  return (
    <section aria-label="ホーム画面に追加">
      <h1 className="text-xl">ホーム画面に追加</h1>
      {installed && <p>この端末ではホーム画面から開いています。</p>}
      {platform === 'ios' && (
        <ol className="list-decimal pl-6">
          <li>Safari でこのページを開く</li>
          <li>共有ボタンを押す</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>ホーム画面のアイコンから開き、「通知をオンにする」</li>
        </ol>
      )}
      {platform !== 'ios' && (
        <ol className="list-decimal pl-6">
          <li>Chrome でこのページを開く</li>
          <li>メニューの「アプリをインストール」を選ぶ</li>
          <li>起動して通知を許可する</li>
        </ol>
      )}
      {canPrompt && (
        <button
          type="button"
          className="min-h-11 px-3 font-bold"
          onClick={() => void promptInstall()}
        >
          インストールする
        </button>
      )}
      <button type="button" className="min-h-11 px-3" onClick={() => navigate(-1)}>
        戻る
      </button>
    </section>
  );
}
