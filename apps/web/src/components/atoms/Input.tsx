import { forwardRef, type InputHTMLAttributes } from 'react';
import { fieldClass } from './FormField';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`${fieldClass} ${className}`} {...props} />;
});
