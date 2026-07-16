import { useQuery } from '@tanstack/react-query';
import { fetchStats } from '../api/runs.js';
import { useAuth } from '../auth/useAuth.js';

/** Health-panel aggregate — polled so the panel tracks reality without a dedicated WS stream. */
export function useStats() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => fetchStats(token!),
    enabled: token !== null,
    refetchInterval: 15_000,
  });
}
