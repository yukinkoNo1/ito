import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMemberVMs } from '../../app/hooks';
import { goBack, useNav } from '../../app/nav';
import SearchScreen from '../../ui/screens/SearchScreen';

/** S-10 検索。端末の DB の部分一致・最近の検索語は Phase 7 でつなぐ（RUNBOOK 7. Phase 6 の 9.） */
export function SearchContainer() {
  const members = useMemberVMs();
  const nav = useNav();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string[] | null>(null);
  return (
    <SearchScreen
      filterMemberIds={filter}
      groups={[]}
      members={members}
      onBack={() => goBack(navigate, '/')}
      onOpenOccurrence={nav.openEvent}
      onQueryChange={setQuery}
      onSetFilter={setFilter}
      query={query}
      recentQueries={[]}
    />
  );
}
