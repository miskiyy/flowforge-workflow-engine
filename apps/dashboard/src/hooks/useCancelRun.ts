import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelRun } from '../api/runs.js';
import { useAuth } from '../auth/useAuth.js';

export function useCancelRun() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => cancelRun(token!, runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
