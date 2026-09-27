import { MEMBER_COLORS } from '@ito/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useData, useMe, useMembers } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import { DEVICE_KEYS, writeDevice } from '../../pwa/device';

/** S-11 はじめて（2 画面だけ: 色を選ぶ → 使い方。素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function WelcomePage() {
  const me = useMe();
  const members = useMembers();
  const { store } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<'color' | 'howto'>('color');

  if (!me) return <p>読み込み中…（家のサーバーにつながると始められます）</p>;
  const taken = new Map(
    members.filter((m) => m.id !== me.id && !m.disabled).map((m) => [m.color, m.mark]),
  );

  if (step === 'color') {
    return (
      <section aria-label="はじめて">
        <h1 className="text-xl">{me.name} さん、ようこそ</h1>
        <p>あなたの色を選んでください</p>
        <fieldset>
          <legend className="sr-only">色</legend>
          {MEMBER_COLORS.map((c) => (
            <label key={c} className="mr-2 inline-flex min-h-11 items-center gap-1">
              <input
                type="radio"
                name="color"
                checked={me.color === c}
                disabled={taken.has(c)}
                onChange={async () => {
                  try {
                    const res = await apiRequest('PATCH', '/api/me', { body: { color: c } });
                    if (res.status === 200) await store.syncNow();
                    else
                      toast.show({
                        kind: 'error',
                        message: 'その色は使えません',
                        actionLabel: null,
                      });
                  } catch {
                    toast.show({
                      kind: 'error',
                      message: '家のサーバーにつながりません',
                      actionLabel: null,
                    });
                  }
                }}
              />
              {c}
              {taken.has(c) ? `（${taken.get(c)}）` : ''}
            </label>
          ))}
        </fieldset>
        <button type="button" className="min-h-11 px-3 font-bold" onClick={() => setStep('howto')}>
          次へ
        </button>
      </section>
    );
  }
  return (
    <section aria-label="使い方">
      <h1 className="text-xl">使い方</h1>
      <p>下の入力欄に「土曜10時 父 ゴルフ」のように書くだけで、家族みんなに共有されます。</p>
      <button
        type="button"
        className="min-h-11 px-3 font-bold"
        onClick={() => {
          writeDevice(DEVICE_KEYS.onboarded, '1');
          navigate('/', { replace: true });
        }}
      >
        はじめる
      </button>
    </section>
  );
}
