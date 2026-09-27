import { BrowserRouter, Route, Routes } from 'react-router';
import { ActivityPage } from '../features/activity/ActivityPage';
import { ComposerOverlay } from '../features/composer/ComposerOverlay';
import { EventPage } from '../features/event/EventPage';
import { FlowPage } from '../features/flow/FlowPage';
import { MonthPage } from '../features/month/MonthPage';
import { MembersPage } from '../features/settings/MembersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TrashPage } from '../features/trash/TrashPage';
import { DataProvider } from './data-context';
import { Shell } from './Shell';
import { ToastProvider } from './toast';

export function App() {
  return (
    <DataProvider>
      <ToastProvider>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<FlowPage />} />
              <Route path="/month/:ym" element={<MonthPage />} />
              <Route path="/month" element={<MonthPage />} />
              <Route path="/e/:eventId" element={<EventPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/members" element={<MembersPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/trash" element={<TrashPage />} />
              <Route path="*" element={<FlowPage />} />
            </Routes>
            <ComposerOverlay />
          </Shell>
        </BrowserRouter>
      </ToastProvider>
    </DataProvider>
  );
}
