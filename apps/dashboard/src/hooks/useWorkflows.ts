import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth.js';
import { listWorkflows, type ListWorkflowsQuery } from '../api/workflows.js';

export function useWorkflows(query: ListWorkflowsQuery) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['workflows', query],
    queryFn: () => listWorkflows(token!, query),
    enabled: token !== null,
  });
}
