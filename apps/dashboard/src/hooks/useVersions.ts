import { useQuery } from '@tanstack/react-query';
import { listVersions } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';

export function useVersions(workflowId: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['versions', workflowId],
    queryFn: () => listVersions(token!, workflowId),
    enabled: token !== null,
  });
}
