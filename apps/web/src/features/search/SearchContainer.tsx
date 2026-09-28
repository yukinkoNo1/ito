import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useEvents } from '../../app/data-context';
import { useMemberVMs } from '../../app/hooks';
import { goBack, useNav } from '../../app/nav';
import { useVmContext } from '../../app/use-vm';
import { DEVICE_KEYS, readDevice, writeDevice } from '../../pwa/device';
import SearchScreen from '../../ui/screens/SearchScreen';
import { rememberQuery, searchOccurrences } from '../../viewmodels/search';

function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(readDevice(DEVICE_KEYS.recentQueries) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

/**
 * S-10 検索（§5 F-19）。端末の DB の件名・場所・メモを部分一致で探す（オフラインでも使える）。
 * 最近の検索語は端末ごとに保存し、結果を開いたときに覚える
 */
export function SearchContainer() {
  const members = useMemberVMs();
  const nav = useNav();
  const navigate = useNavigate();
  const events = useEvents();
  const ctx = useVmContext();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const groups = useMemo(
    () => (ctx && events ? searchOccurrences(events, query, filter, ctx) : []),
    [events, query, filter, ctx],
  );
  return (
    <SearchScreen
      filterMemberIds={filter}
      groups={groups}
      members={members}
      onBack={() => goBack(navigate, '/')}
      onOpenOccurrence={(key) => {
        const next = rememberQuery(recent, query);
        setRecent(next);
        writeDevice(DEVICE_KEYS.recentQueries, JSON.stringify(next));
        nav.openEvent(key);
      }}
      onQueryChange={setQuery}
      onSetFilter={setFilter}
      query={query}
      recentQueries={recent}
    />
  );
}
