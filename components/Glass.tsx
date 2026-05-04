import React from 'react';

interface GlassProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'light' | 'dark' | 'accent';
  interactive?: boolean;
}

// Renamed internally to reflect visual change, but exported as GlassCard to maintain compatibility
export const GlassCard: React.FC<GlassProps> = ({ 
  children, 
  className = '', 
  variant = 'light',
  interactive = false,
  ...props 
}) => {
  // Linear/Attio style: White background, subtle grey border, minimal shadow
  const baseClasses = 'bg-white border border-slate-200 shadow-sm';
  const interactiveClasses = interactive 
    ? 'cursor-pointer transition-all duration-200 hover:border-slate-300 hover:shadow-md' 
    : '';

  return (
    <div 
      className={`rounded-lg ${baseClasses} ${interactiveClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const GlassButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }> = ({
  children,
  className = '',
  variant = 'primary',
  ...props
}) => {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm border border-transparent',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-sm',
    outline: 'bg-transparent text-slate-600 hover:text-slate-900 border border-transparent hover:bg-slate-100',
  };

  return (
    <button
      className={`
        px-4 py-2 rounded-md font-medium text-sm transition-all duration-200
        active:scale-[0.98]
        ${variants[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
};