import { lazy } from 'react';

/**
 * 最初に開く画面（これから・月）と、詳細・書く画面（ShellLayout）のほかは、開いたときに読む
 * （§19 の初回表示の JS を gzip で 200KB 以内に。§24 D38）。SW がプリキャッシュし、手が空いたときにも読んでおく
 */
const loaders = {
  free: () => import('../features/free/FreeContainer'),
  search: () => import('../features/search/SearchContainer'),
  settings: () => import('../features/settings/SettingsContainer'),
  members: () => import('../features/settings/MembersContainer'),
  activity: () => import('../features/activity/ActivityContainer'),
  trash: () => import('../features/trash/TrashContainer'),
  install: () => import('../features/install/InstallContainer'),
  onboarding: () => import('../features/onboarding/OnboardingContainer'),
};

export const FreeContainer = lazy(() => loaders.free().then((m) => ({ default: m.FreeContainer })));
export const SearchContainer = lazy(() =>
  loaders.search().then((m) => ({ default: m.SearchContainer })),
);
export const SettingsContainer = lazy(() =>
  loaders.settings().then((m) => ({ default: m.SettingsContainer })),
);
export const MembersContainer = lazy(() =>
  loaders.members().then((m) => ({ default: m.MembersContainer })),
);
export const ActivityContainer = lazy(() =>
  loaders.activity().then((m) => ({ default: m.ActivityContainer })),
);
export const TrashContainer = lazy(() =>
  loaders.trash().then((m) => ({ default: m.TrashContainer })),
);
export const InstallContainer = lazy(() =>
  loaders.install().then((m) => ({ default: m.InstallContainer })),
);
export const OnboardingContainer = lazy(() =>
  loaders.onboarding().then((m) => ({ default: m.OnboardingContainer })),
);

/** 手が空いたときに、ほかの画面も読んでおく（オフラインになる前に） */
export async function prefetchScreens(): Promise<void> {
  await Promise.all(Object.values(loaders).map((load) => load()));
}
