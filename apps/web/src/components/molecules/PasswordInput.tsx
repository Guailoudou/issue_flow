import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';
import { Input } from '../atoms/Input';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  visibilityLabel: string;
}

export function PasswordInput({ visibilityLabel, className = '', ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <Input type={visible ? 'text' : 'password'} className={`pr-12 ${className}`} {...props} />
    <button type="button" className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-r-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-label={`${visible ? '隐藏' : '显示'}${visibilityLabel}`} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
      {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
    </button>
  </div>;
}
