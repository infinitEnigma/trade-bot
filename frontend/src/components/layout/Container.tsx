import React from 'react';
import { cn } from '../../lib/utils';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full' | {
    default?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    sm?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    md?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    lg?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    xl?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    '2xl'?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    '3xl'?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
    '4xl'?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  };
  padding?: 'none' | 'sm' | 'md' | 'lg';
  centerContent?: boolean;
}

/**
 * Container provides consistent horizontal centering and max-width constraints.
 * Supports responsive padding and different size variants.
 */
export const Container: React.FC<ContainerProps> = ({
  children,
  className,
  size = 'lg',
  padding = 'md'
}) => {
  const sizeClasses = {
    sm: 'max-w-2xl',        // 672px - Mobile
    md: 'max-w-5xl',        // 1024px - Tablet (increased)
    lg: 'max-w-7xl',        // 1280px - Desktop (increased from 6xl)
    xl: 'max-w-[1440px]',   // 1440px - Large Desktop (increased)
    '2xl': 'max-w-[1800px]', // 1800px - Ultra-wide (increased)
    '3xl': 'max-w-[2200px]', // 2200px - 1080p displays (increased)
    '4xl': 'max-w-[2800px]', // 2800px - 1440p displays (increased)
    full: 'w-full'
  };

  const paddingClasses = {
    none: '',
    sm: 'px-4 sm:px-6',
    md: 'px-4 sm:px-6 lg:px-8',
    lg: 'px-4 sm:px-6 lg:px-8 xl:px-12'
  };

  // Handle responsive size object
  let sizeClass = '';
  if (typeof size === 'string') {
    sizeClass = sizeClasses[size] || sizeClasses.lg;
  } else {
    // Build responsive classes
    const responsiveClasses = [];
    if (size.default) responsiveClasses.push(sizeClasses[size.default]);
    if (size.sm) responsiveClasses.push(`sm:${sizeClasses[size.sm]}`);
    if (size.md) responsiveClasses.push(`md:${sizeClasses[size.md]}`);
    if (size.lg) responsiveClasses.push(`lg:${sizeClasses[size.lg]}`);
    if (size.xl) responsiveClasses.push(`xl:${sizeClasses[size.xl]}`);
    if (size['2xl']) responsiveClasses.push(`2xl:${sizeClasses[size['2xl']]}`);
    if (size['3xl']) responsiveClasses.push(`3xl:${sizeClasses[size['3xl']]}`);
    if (size['4xl']) responsiveClasses.push(`4xl:${sizeClasses[size['4xl']]}`);
    sizeClass = responsiveClasses.join(' ');
  }

  return (
    <div className={cn(
      'mx-auto w-full',
      sizeClass,
      paddingClasses[padding],
      className
    )}>
      {children}
    </div>
  );
};
