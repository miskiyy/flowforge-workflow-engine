import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateWorkflow, type UpdateWorkflowInput } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';

export function useUpdateWorkflow(workflowId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkflowInput) => updateWorkflow(token!, workflowId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['versions', workflowId] });
    },
  });
}
