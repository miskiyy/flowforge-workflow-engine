import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createWorkflow, type CreateWorkflowInput } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';

export function useCreateWorkflow() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) => createWorkflow(token!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
