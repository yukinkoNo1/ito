import { type ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ActivityPage } from '../features/activity/ActivityPage';
import { ComposerOverlay } from '../features/composer/ComposerOverlay';
import { EventPage } from '../features/event/EventPage';
import { FlowPage } from '../features/flow/FlowPage';
import { InstallPage } from '../features/install/InstallPage';
import { MonthPage } from '../features/month/MonthPage';
import { WelcomePage } from '../features/onboarding/WelcomePage';
import { MembersPage } from '../features/settings/MembersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TrashPage } from '../features/trash/TrashPage';
import { DEVICE_KEYS, readDevice } from '../pwa/device';
import { registerServiceWorker } from '../pwa/register';
import { DataProvider } from './data-context';
import { FreshProvider } from './fresh';
import { Shell } from './Shell';
import { ToastProvider } from './toast';
import { UpdateContext } from './update';

/** はじめての端末は S-11 へ（ホーム画面に追加ガイドは見られる） */
function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const onboarded = readDevice(DEVICE_KEYS.onboarded) === '1';
  if (!onboarded && location.pathname !== '/welcome' && location.pathname !== '/install') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  useEffect(() => {
    registerServiceWorker((apply) => setApplyUpdate(() => apply));
  }, []);
  return (
    <DataProvider>
      <FreshProvider>
        <ToastProvider>
          <UpdateContext.Provider value={applyUpdate}>
            <BrowserRouter>
              <Shell>
                <OnboardingGate>
                  <Routes>
                    <Route path="/" element={<FlowPage />} />
                    <Route path="/month/:ym" element={<MonthPage />} />
                    <Route path="/month" element={<MonthPage />} />
                    <Route path="/e/:eventId" element={<EventPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/members" element={<MembersPage />} />
                    <Route path="/activity" element={<ActivityPage />} />
                    <Route path="/trash" element={<TrashPage />} />
                    <Route path="/welcome" element={<WelcomePage />} />
                    <Route path="/install" element={<InstallPage />} />
                    <Route path="*" element={<FlowPage />} />
                  </Routes>
                  <ComposerOverlay />
                </OnboardingGate>
              </Shell>
            </BrowserRouter>
          </UpdateContext.Provider>
        </ToastProvider>
      </FreshProvider>
    </DataProvider>
  );
}
