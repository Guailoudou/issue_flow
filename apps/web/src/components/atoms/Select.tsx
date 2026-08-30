import { forwardRef, type SelectHTMLAttributes } from 'react';
import { fieldClass } from './FormField';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', children, ...props }, ref) {
  return <select ref={ref} className={`${fieldClass} ${className}`} {...props}>{children}</select>;
});
