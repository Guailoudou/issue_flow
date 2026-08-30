import type { Milestone } from '../../lib/types';
import { Select } from '../atoms/Select';
export function MilestonePicker({ milestones, value, onChange }: { milestones: Milestone[]; value: number | ''; onChange: (id: number | '') => void }) {
  return <Select aria-label="里程碑" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}><option value="">无里程碑</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</Select>;
}
