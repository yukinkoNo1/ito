import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ActivityContainer } from '../features/activity/ActivityContainer';
import { FlowContainer } from '../features/flow/FlowContainer';
import { FreeContainer } from '../features/free/FreeContainer';
import { InstallContainer } from '../features/install/InstallContainer';
import { MonthContainer } from '../features/month/MonthContainer';
import { OnboardingContainer } from '../features/onboarding/OnboardingContainer';
import { SearchContainer } from '../features/search/SearchContainer';
import { MembersContainer } from '../features/settings/MembersContainer';
import { SettingsContainer } from '../features/settings/SettingsContainer';
import { BareLayout } from '../features/shell/BareLayout';
import { ShellLayout } from '../features/shell/ShellLayout';
import { TrashContainer } from '../features/trash/TrashContainer';
import { DEVICE_KEYS, readDevice } from '../pwa/device';
import { registerServiceWorker } from '../pwa/register';
import { readThemeSetting, setTheme } from './appearance';
import { DataProvider, useMe } from './data-context';
import { FreshProvider } from './fresh';
import { NavProvider, useNav } from './nav';
import { PushSync } from './push-sync';
import { ToastProvider } from './toast';
import { UpdateContext } from './update';
import { ViewDateProvider } from './view-date';

/** 状態のギャラリー（開発と E2E 用のビルドにだけ入れる。本番のビルドでは分岐ごと消える。RUNBOOK 3.） */
const Gallery =
  import.meta.env.DEV || __ITO_E2E__ ? lazy(() => import('../ui/gallery/Gallery')) : null;

/** はじめての端末は S-11 へ（ホーム画面に追加ガイドは見られる） */
function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const onboarded = readDevice(DEVICE_KEYS.onboarded) === '1';
  if (!onboarded && location.pathname !== '/welcome' && location.pathname !== '/install') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

/** テーマは家族の設定（me.settings.theme）に合わせる。まだ読めていなければ端末に写しておいたもの（§22） */
function AppearanceSync() {
  const theme = useMe()?.settings.theme;
  useEffect(() => setTheme(theme ?? readThemeSetting()), [theme]);
  return null;
}

/** 詳細（/e/:id）は開く前の画面（背景）の上にシートとして重ねる（§6.3 S-04） */
function AppRoutes() {
  const { base } = useNav();
  return (
    <OnboardingGate>
      <Routes location={base}>
        <Route element={<BareLayout />}>
          <Route path="/welcome" element={<OnboardingContainer />} />
          <Route path="/install" element={<InstallContainer />} />
        </Route>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<FlowContainer />} />
          <Route path="/month/:ym?" element={<MonthContainer />} />
          <Route path="/free" element={<FreeContainer />} />
          <Route path="/search" element={<SearchContainer />} />
          <Route path="/settings" element={<SettingsContainer />} />
          <Route path="/settings/members" element={<MembersContainer />} />
          <Route path="/activity" element={<ActivityContainer />} />
          <Route path="/trash" element={<TrashContainer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OnboardingGate>
  );
}

export function App() {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  const galleryPage = Gallery !== null && window.location.pathname === '/__gallery';
  useEffect(() => {
    if (!galleryPage) registerServiceWorker((apply) => setApplyUpdate(() => apply));
  }, [galleryPage]);

  // ギャラリーは同期も SW も使わない（見本のデータだけで描く）
  if (Gallery && galleryPage) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return (
    <DataProvider>
      <AppearanceSync />
      <FreshProvider>
        <ToastProvider>
          <UpdateContext.Provider value={applyUpdate}>
            <ViewDateProvider>
              <BrowserRouter>
                <NavProvider>
                  <PushSync />
                  <AppRoutes />
                </NavProvider>
              </BrowserRouter>
            </ViewDateProvider>
          </UpdateContext.Provider>
        </ToastProvider>
      </FreshProvider>
    </DataProvider>
  );
}
