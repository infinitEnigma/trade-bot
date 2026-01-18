import React from 'react';
import { cn } from '../../lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  minHeight?: string;
}

/**
 * PageLayout provides consistent page structure with header, main content, and footer.
 * Handles background, min-height, and responsive spacing.
 */
export const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  className,
  header,
  footer,
  minHeight = 'min-h-screen'
}) => {
  return (
    <div className={cn(
      'bg-background',
      minHeight,
      className
    )}>
      {header && (
        <header className="sticky top-0 z-50">
          {header}
        </header>
      )}

      <main className={cn(
        "flex-1 min-h-0",
        header && "pt-20" // Add top padding when header is present to account for sticky header
      )}>
        <div className="w-full h-full">
          {children}
        </div>
      </main>

      {footer && (
        <footer className="mt-auto">
          {footer}
        </footer>
      )}
    </div>
  );
};
