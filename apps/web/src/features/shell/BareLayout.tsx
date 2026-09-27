import { Outlet } from 'react-router';
import { useToast } from '../../app/toast';
import { ToastBar } from '../../ui/primitives/AppShell';

/**
 * 下の帯のない画面（S-11 はじめて・S-12 ホーム画面に追加）の枠。トースト（C-03）だけを画面の下に出す
 * （色を選んで保存できなかったときなど）
 */
export function BareLayout() {
  const toast = useToast();
  const t = toast.current;
  return (
    <>
      <Outlet />
      {t && (
        <div className="toast-layer toast-layer--bare">
          <ToastBar
            onAction={toast.act}
            onDismiss={toast.dismiss}
            toast={{
              id: String(t.id),
              kind: t.kind,
              message: t.message,
              actionLabel: t.actionLabel,
            }}
          />
        </div>
      )}
    </>
  );
}
