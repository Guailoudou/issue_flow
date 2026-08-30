import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IssueSidebar } from './IssueSidebar';

describe('IssueSidebar', () => {
  it('分别编辑负责人、标签和里程碑', () => {
    const editOwners = vi.fn(); const editLabels = vi.fn(); const editMilestone = vi.fn();
    render(<MemoryRouter><IssueSidebar issue={{ id: 1, number: 1, title: 'Issue', status: 'OPEN', author: { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN', active: true }, assignees: [], productOwners: [], developerOwners: [], labels: [], createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' }} onEditOwners={editOwners} onEditLabels={editLabels} onEditMilestone={editMilestone} onToggleSubscribe={vi.fn()} /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '编辑负责人' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑里程碑' }));
    expect(editOwners).toHaveBeenCalledOnce(); expect(editLabels).toHaveBeenCalledOnce(); expect(editMilestone).toHaveBeenCalledOnce();
  });
});
