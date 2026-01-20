import React from 'react';
import { cn } from '../../utils';

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  spacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  as?: 'section' | 'div';
}

/**
 * Section provides consistent vertical spacing for content sections.
 * Uses the standardized spacing scale (multiples of 4px).
 */
export const Section: React.FC<SectionProps> = ({
  children,
  className,
  spacing = 'md',
  as: Component = 'section'
}) => {
  const spacingClasses = {
    xs: 'py-4',      // 16px
    sm: 'py-6',      // 24px
    md: 'py-8',      // 32px
    lg: 'py-12',     // 48px
    xl: 'py-16'      // 64px
  };

  return (
    <Component className={cn(
      spacingClasses[spacing],
      className
    )}>
      {children}
    </Component>
  );
};
