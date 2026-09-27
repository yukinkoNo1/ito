import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useData, useMe, useMembers } from '../../app/data-context';
import { useSyncVM } from '../../app/hooks';
import { sendOnline } from '../../app/online-actions';
import { useToast } from '../../app/toast';
import { DEVICE_KEYS, writeDevice } from '../../pwa/device';
import { connectionText } from '../../ui/primitives/AppShell';
import { Button } from '../../ui/primitives/Controls';
import OnboardingScreen from '../../ui/screens/OnboardingScreen';
import type { OnboardingStep } from '../../ui/types';

/** S-11 はじめて（2 画面だけ: 色を選ぶ → 使い方。ホーム画面への追加と通知は、あとでホームの案内から） */
export function OnboardingContainer() {
  const me = useMe();
  const members = useMembers();
  const { store } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('color');
  const sync = useSyncVM();

  if (!me) {
    // まだ本人が分からない: 同期が止まった理由（401・403・つながらない）を出す（C-02。§12）
    const reason = connectionText(sync);
    return (
      <main className="app-shell onboarding-screen">
        <p className="detail-meta" role="status">
          {reason ?? '読み込み中…（家のサーバーにつながると始められます）'}
        </p>
        {(sync.status === 'offline' || sync.status === 'error') && (
          <Button onClick={() => void store.syncNow({ retryNow: true })}>再試行</Button>
        )}
      </main>
    );
  }
  return (
    <OnboardingScreen
      me={{ id: me.id, name: me.name, mark: me.mark, color: me.color, isMe: true }}
      onNext={() => {
        if (step === 'color') {
          setStep('howto');
          return;
        }
        writeDevice(DEVICE_KEYS.onboarded, '1');
        navigate('/', { replace: true });
      }}
      onPickColor={(color) => void sendOnline(store, toast.show, 'PATCH', '/api/me', { color })}
      step={step}
      takenColors={members
        .filter((m) => m.id !== me.id && !m.disabled)
        .map((m) => ({ color: m.color, mark: m.mark }))}
    />
  );
}
