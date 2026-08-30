import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';
describe('MarkdownRenderer', () => { it('渲染 GFM 并清理危险脚本', () => { const { container } = render(<MarkdownRenderer value={'**加粗**\n\n<script>alert(1)</script>'} />); expect(screen.getByText('加粗')).toBeInTheDocument(); expect(container.querySelector('script')).not.toBeInTheDocument(); }); });
