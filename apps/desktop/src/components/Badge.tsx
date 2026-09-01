import type { ReactNode } from 'react';

type BadgeVariant = 'teal' | 'orange' | 'slate' | 'green' | 'red' | 'custom';

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastingLabelColors(hex: string): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      backgroundColor: '#f1f5f9',
      color: '#334155',
      borderColor: '#cbd5e1',
    };
  }
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);

  // Final opaque RGB background blended 12% tint over white (#ffffff)
  const bgR = Math.round(0.12 * r + 0.88 * 255);
  const bgG = Math.round(0.12 * g + 0.88 * 255);
  const bgB = Math.round(0.12 * b + 0.88 * 255);
  const bgLum = getRelativeLuminance(bgR, bgG, bgB);

  // Iteratively darken text color to reach contrast ratio >= 4.5:1
  let factor = 0.5;
  let textR = Math.round(r * factor);
  let textG = Math.round(g * factor);
  let textB = Math.round(b * factor);
  let textLum = getRelativeLuminance(textR, textG, textB);
  let cr = getContrastRatio(bgLum, textLum);

  while (cr < 4.5 && factor > 0.05) {
    factor -= 0.05;
    textR = Math.round(r * factor);
    textG = Math.round(g * factor);
    textB = Math.round(b * factor);
    textLum = getRelativeLuminance(textR, textG, textB);
    cr = getContrastRatio(bgLum, textLum);
  }

  if (cr < 4.5) {
    textR = 15;
    textG = 23;
    textB = 42;
  }

  const borderR = Math.round(0.3 * r + 0.7 * 255);
  const borderG = Math.round(0.3 * g + 0.7 * 255);
  const borderB = Math.round(0.3 * b + 0.7 * 255);

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const textHex = `#${toHex(textR)}${toHex(textG)}${toHex(textB)}`;
  const bgHex = `#${toHex(bgR)}${toHex(bgG)}${toHex(bgB)}`;
  const borderHex = `#${toHex(borderR)}${toHex(borderG)}${toHex(borderB)}`;

  return {
    backgroundColor: bgHex,
    color: textHex,
    borderColor: borderHex,
  };
}

export function Badge({
  children,
  variant = 'slate',
  customBg,
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  customBg?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const styles: Record<BadgeVariant, string> = {
    teal: 'bg-brand-50 text-brand-700 border-brand-200',
    orange: 'bg-accent-50 text-accent-700 border-accent-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    custom: '',
  };

  const inlineStyle = customBg ? getContrastingLabelColors(customBg) : undefined;

  return (
    <span
      style={inlineStyle}
      aria-label={ariaLabel}
      className={`inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium rounded border ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
