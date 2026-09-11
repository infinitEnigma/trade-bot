/** @format */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Page-specific background pattern mapping
const pagePatterns = {
    '/dashboard': 'pattern-grid-medium',
    '/strategies': 'pattern-dots-medium',
    '/analytics': 'pattern-waves-flow',
    '/profile': 'pattern-hexagons',
    '/settings': '', // No pattern for clean settings page
    '/login': '', // No pattern for auth pages
    '/register': '', // No pattern for auth pages
} as const;

export const usePageBackground = () => {
    const location = useLocation();

    useEffect(() => {
        // Remove all existing pattern classes
        const patternClasses = Object.values(pagePatterns).filter(Boolean);
        document.body.classList.remove(...patternClasses);

        // Add the appropriate pattern class for the current page
        const currentPath = location.pathname;
        const patternClass = pagePatterns[currentPath as keyof typeof pagePatterns] ||
            pagePatterns['/dashboard']; // Default to dashboard pattern

        if (patternClass) {
            document.body.classList.add(patternClass);
        }

        // Cleanup function to remove pattern on unmount
        return () => {
            if (patternClass) {
                document.body.classList.remove(patternClass);
            }
        };
    }, [location.pathname]);
};
