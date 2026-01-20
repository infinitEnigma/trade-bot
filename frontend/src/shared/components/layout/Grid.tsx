import React from 'react';
import { cn } from '../../utils';

interface GridProps {
  children: React.ReactNode;
  className?: string;
  cols?: {
    default?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  gap?: number | string;
  autoFit?: boolean;
  minWidth?: string;
}

/**
 * Grid provides a flexible grid layout with responsive columns and consistent gaps.
 * Supports both fixed columns and auto-fit for responsive card layouts.
 */
export const Grid: React.FC<GridProps> = ({
  children,
  className,
  cols = { default: 1, md: 2, lg: 3 },
  gap = 6,
  autoFit = false,
  minWidth
}) => {
  const gapValue = typeof gap === 'number' ? `gap-${gap}` : gap;

  if (autoFit && minWidth) {
    // Auto-fit grid for responsive cards
    return (
      <div
        className={cn(
          'grid',
          `gap-${gap}`,
          className
        )}
        style={{
          gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}, 1fr))`
        }}
      >
        {children}
      </div>
    );
  }

  // Standard responsive grid
  const colClasses = [];

  if (cols.default) colClasses.push(`grid-cols-${cols.default}`);
  if (cols.sm) colClasses.push(`sm:grid-cols-${cols.sm}`);
  if (cols.md) colClasses.push(`md:grid-cols-${cols.md}`);
  if (cols.lg) colClasses.push(`lg:grid-cols-${cols.lg}`);
  if (cols.xl) colClasses.push(`xl:grid-cols-${cols.xl}`);

  return (
    <div className={cn(
      'grid',
      gapValue,
      ...colClasses,
      className
    )}>
      {children}
    </div>
  );
};
