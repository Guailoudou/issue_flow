import { forwardRef, type InputHTMLAttributes } from 'react';
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Checkbox(props, ref) {
  return <input ref={ref} type="checkbox" className="size-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600" {...props} />;
});
