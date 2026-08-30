import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
export function MarkdownRenderer({ value, emptyText = '暂无内容' }: { value?: string; emptyText?: string }) {
  if (!value?.trim()) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{value}</ReactMarkdown></div>;
}
