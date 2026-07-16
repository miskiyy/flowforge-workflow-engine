import { useMutation, useQueryClient } from '@tanstack/react-query';
import { triggerRun } from '../api/runs.js';
import { useAuth } from '../auth/useAuth.js';

export function useTriggerRun() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) => triggerRun(token!, workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
