import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppVersion, appVersion } from './AppVersion';

describe('AppVersion', () => {
  it('展示版本号、构建标识和构建时间', () => {
    render(<AppVersion backend={{ version: appVersion.version, buildId: '20260829153000', builtAt: '2026-08-29T07:30:00.000Z' }} />);
    expect(screen.getByRole('heading', { name: '当前部署版本' })).toBeInTheDocument();
    expect(screen.getAllByText(`v${appVersion.version}`)).toHaveLength(2);
    expect(screen.getByText(appVersion.buildId)).toBeInTheDocument();
    expect(screen.getByText('20260829153000')).toBeInTheDocument();
    expect(screen.getAllByText(/构建于/)).toHaveLength(2);
  });
});
