import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { fieldClass } from './FormField';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`${fieldClass} min-h-28 resize-y ${className}`} {...props} />;
});
