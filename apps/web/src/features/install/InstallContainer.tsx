import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { goBack } from '../../app/nav';
import {
  canPromptInstall,
  detectPlatform,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from '../../pwa/install';
import InstallGuideScreen from '../../ui/screens/InstallGuideScreen';

/** S-12 ホーム画面に追加ガイド（iOS／Android 別の手順。付録B） */
export function InstallContainer() {
  const navigate = useNavigate();
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), []);
  return (
    <InstallGuideScreen
      canPrompt={canPrompt}
      installed={isStandalone()}
      onBack={() => goBack(navigate, '/')}
      onPromptInstall={() => void promptInstall()}
      platform={detectPlatform()}
    />
  );
}
