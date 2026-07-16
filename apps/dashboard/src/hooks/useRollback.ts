import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rollbackWorkflow, type WorkflowDefinition, type WorkflowVersion } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';

interface WorkflowQueryData {
  workflow: WorkflowDefinition;
  version: WorkflowVersion | null;
}

/** Optimistic — trivially reversible (§7): flips `currentVersionId` immediately, reverts to the snapshot on error. */
export function useRollback(workflowId: string, onError?: () => void) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (versionId: string) => rollbackWorkflow(token!, workflowId, versionId),
    onMutate: async (versionId: string) => {
      await queryClient.cancelQueries({ queryKey: ['workflow', workflowId] });
      const previous = queryClient.getQueryData<WorkflowQueryData>(['workflow', workflowId]);
      if (previous) {
        queryClient.setQueryData<WorkflowQueryData>(['workflow', workflowId], {
          ...previous,
          workflow: { ...previous.workflow, currentVersionId: versionId },
        });
      }
      return { previous };
    },
    onError: (_error, _versionId, context) => {
      if (context?.previous) queryClient.setQueryData(['workflow', workflowId], context.previous);
      onError?.();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['versions', workflowId] });
    },
  });
}
