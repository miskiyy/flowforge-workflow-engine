import { useQuery } from '@tanstack/react-query';
import { getWorkflow } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';

/** `id` may be undefined (e.g. the "new workflow" route) — the query simply stays disabled. */
export function useWorkflow(id: string | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['workflow', id],
    queryFn: () => getWorkflow(token!, id!),
    enabled: token !== null && id !== undefined,
  });
}
