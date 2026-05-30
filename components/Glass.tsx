import React from 'react';
import { motion } from 'framer-motion';

interface GlassProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'light' | 'dark' | 'accent';
  interactive?: boolean;
}

export const GlassCard: React.FC<GlassProps> = ({ 
  children, 
  className = '', 
  variant = 'light',
  interactive = false,
  ...props 
}) => {
  const baseClasses = 'bg-background border border-border shadow-sm';
  const interactiveClasses = interactive ? 'cursor-pointer' : '';
  const combinedClass = `rounded-lg ${baseClasses} ${interactiveClasses} ${className}`;

  if (interactive) {
    return (
      <motion.div
        className={combinedClass}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        transition={{ type: 'spring' as const, stiffness: 400, damping: 25 }}
        {...(props as Record<string, unknown>)}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={combinedClass} {...props}>
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
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm border border-transparent',
    secondary: 'bg-background text-foreground hover:bg-muted border border-border shadow-sm',
    outline: 'bg-transparent text-muted-foreground hover:text-foreground border border-transparent hover:bg-muted',
  };

  return (
    <motion.button
      className={`
        px-4 py-2 rounded-md font-medium text-sm transition-all duration-200
        ${variants[variant]}
        ${className}
      `}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.button>
  );
};