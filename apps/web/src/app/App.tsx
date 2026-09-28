import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { FlowContainer } from '../features/flow/FlowContainer';
import { MonthContainer } from '../features/month/MonthContainer';
import { BareLayout } from '../features/shell/BareLayout';
import { ShellLayout } from '../features/shell/ShellLayout';
import { DEVICE_KEYS, readDevice } from '../pwa/device';
import { registerServiceWorker } from '../pwa/register';
import { readThemeSetting, setTheme } from './appearance';
import { DataProvider, useMe } from './data-context';
import { FreshProvider } from './fresh';
import { NavProvider, useNav } from './nav';
import { PushSync } from './push-sync';
import {
  ActivityContainer,
  FreeContainer,
  InstallContainer,
  MembersContainer,
  OnboardingContainer,
  SearchContainer,
  SettingsContainer,
  TrashContainer,
} from './screens';
import { ToastProvider } from './toast';
import { UpdateContext } from './update';
import { ViewDateProvider } from './view-date';

/** 状態のギャラリー（開発と E2E 用のビルドにだけ入れる。本番のビルドでは分岐ごと消える。RUNBOOK 3.） */
const Gallery =
  import.meta.env.DEV || __ITO_E2E__ ? lazy(() => import('../ui/gallery/Gallery')) : null;

/** 読み込み中（開いたときに読む画面） */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="detail-meta">読み込み中…</p>}>{children}</Suspense>;
}

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
          <Route
            path="/welcome"
            element={
              <Lazy>
                <OnboardingContainer />
              </Lazy>
            }
          />
          <Route
            path="/install"
            element={
              <Lazy>
                <InstallContainer />
              </Lazy>
            }
          />
        </Route>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<FlowContainer />} />
          <Route path="/month/:ym?" element={<MonthContainer />} />
          <Route
            path="/free"
            element={
              <Lazy>
                <FreeContainer />
              </Lazy>
            }
          />
          <Route
            path="/search"
            element={
              <Lazy>
                <SearchContainer />
              </Lazy>
            }
          />
          <Route
            path="/settings"
            element={
              <Lazy>
                <SettingsContainer />
              </Lazy>
            }
          />
          <Route
            path="/settings/members"
            element={
              <Lazy>
                <MembersContainer />
              </Lazy>
            }
          />
          <Route
            path="/activity"
            element={
              <Lazy>
                <ActivityContainer />
              </Lazy>
            }
          />
          <Route
            path="/trash"
            element={
              <Lazy>
                <TrashContainer />
              </Lazy>
            }
          />
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
