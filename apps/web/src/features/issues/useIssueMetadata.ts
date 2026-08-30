import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Label, Milestone, User } from '../../lib/types';
export function useIssueMetadata() {
  const users = useQuery({ queryKey: ['users-active'], queryFn: async () => (await api<{ items: User[] }>('/users')).items.filter((user) => user.active) });
  const labels = useQuery({ queryKey: ['labels'], queryFn: async () => (await api<{ items: Label[] }>('/labels')).items });
  const milestones = useQuery({ queryKey: ['milestones-open'], queryFn: async () => (await api<{ items: Milestone[] }>('/milestones')).items.filter((item) => (item.state ?? item.status ?? 'OPEN') === 'OPEN') });
  return { users: users.data ?? [], labels: labels.data ?? [], milestones: milestones.data ?? [], loading: users.isPending || labels.isPending || milestones.isPending };
}
