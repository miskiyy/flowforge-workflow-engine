import { useQuery } from '@tanstack/react-query';
import { listRuns, type ListRunsQuery } from '../api/runs.js';
import { useAuth } from '../auth/useAuth.js';

export function useRuns(query: ListRunsQuery) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['runs', query],
    queryFn: () => listRuns(token!, query),
    enabled: token !== null,
  });
}
