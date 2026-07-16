import { useMutation } from '@tanstack/react-query';
import { proposeWorkflow, type ProposeInput } from '../api/ai.js';
import { useAuth } from '../auth/useAuth.js';

export function usePropose() {
  const { token } = useAuth();
  return useMutation({
    mutationFn: (input: ProposeInput) => proposeWorkflow(token!, input),
  });
}
