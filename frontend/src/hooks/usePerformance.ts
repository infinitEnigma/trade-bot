/** @format */

import { useEffect, useState } from 'react';

// Web Vitals metrics interface
interface WebVitalsMetrics {
    cls: number | null; // Cumulative Layout Shift
    fid: number | null; // First Input Delay
    fcp: number | null; // First Contentful Paint
    lcp: number | null; // Largest Contentful Paint
    ttfb: number | null; // Time to First Byte
}

// Performance metrics interface
interface PerformanceMetrics {
    bundleSize: number;
    loadTime: number;
    memoryUsage: number;
    networkRequests: number;
    cacheHitRate: number;
}

// Performance hook
export const usePerformance = () => {
    const [webVitals, setWebVitals] = useState<WebVitalsMetrics>({
        cls: null,
        fid: null,
        fcp: null,
        lcp: null,
        ttfb: null,
    });

    const [metrics, setMetrics] = useState<PerformanceMetrics>({
        bundleSize: 0,
        loadTime: 0,
        memoryUsage: 0,
        networkRequests: 0,
        cacheHitRate: 0,
    });

    // Web Vitals tracking
    useEffect(() => {
        // First Contentful Paint (FCP)
        const observeFCP = () => {
            if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.name === 'first-contentful-paint') {
                            setWebVitals(prev => ({ ...prev, fcp: entry.startTime }));
                        }
                    }
                });
                observer.observe({ entryTypes: ['paint'] });
            }
        };

        // Largest Contentful Paint (LCP)
        const observeLCP = () => {
            if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    setWebVitals(prev => ({ ...prev, lcp: lastEntry.startTime }));
                });
                observer.observe({ entryTypes: ['largest-contentful-paint'] });
            }
        };

        // First Input Delay (FID)
        const observeFID = () => {
            if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const eventEntry = entry as PerformanceEventTiming;
                        setWebVitals(prev => ({ ...prev, fid: eventEntry.processingStart - eventEntry.startTime }));
                    }
                });
                observer.observe({ entryTypes: ['first-input'] });
            }
        };

        // Cumulative Layout Shift (CLS)
        const observeCLS = () => {
            if ('PerformanceObserver' in window) {
                let clsValue = 0;
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!(entry as any).hadRecentInput) {
                            clsValue += (entry as any).value;
                        }
                    }
                    setWebVitals(prev => ({ ...prev, cls: clsValue }));
                });
                observer.observe({ entryTypes: ['layout-shift'] });
            }
        };

        // Time to First Byte (TTFB)
        const observeTTFB = () => {
            if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const responseStart = (entry as any).responseStart;
                        const requestStart = (entry as any).requestStart;
                        if (responseStart && requestStart) {
                            setWebVitals(prev => ({ ...prev, ttfb: responseStart - requestStart }));
                        }
                    }
                });
                observer.observe({ entryTypes: ['navigation'] });
            }
        };

        observeFCP();
        observeLCP();
        observeFID();
        observeCLS();
        observeTTFB();
    }, []);

    // Bundle size and load time tracking
    useEffect(() => {
        const trackBundleMetrics = () => {
            // Get navigation timing
            const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

            if (navigation) {
                setMetrics(prev => ({
                    ...prev,
                    loadTime: navigation.loadEventEnd - navigation.fetchStart,
                }));
            }

            // Estimate bundle size from performance entries
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const jsResources = resources.filter(entry =>
                entry.name.includes('.js') &&
                !entry.name.includes('node_modules') &&
                !entry.name.includes('vendor')
            );

            // Estimate bundle size (rough calculation)
            const estimatedBundleSize = jsResources.reduce((total, entry) => {
                return total + (entry.transferSize || entry.decodedBodySize || 0);
            }, 0);

            setMetrics(prev => ({
                ...prev,
                bundleSize: estimatedBundleSize,
                networkRequests: resources.length,
            }));
        };

        // Track on load and periodically
        window.addEventListener('load', trackBundleMetrics);
        const interval = setInterval(trackBundleMetrics, 30000); // Every 30 seconds

        return () => {
            window.removeEventListener('load', trackBundleMetrics);
            clearInterval(interval);
        };
    }, []);

    // Memory usage tracking
    useEffect(() => {
        const trackMemoryUsage = () => {
            if ('memory' in performance) {
                const memory = (performance as any).memory;
                setMetrics(prev => ({
                    ...prev,
                    memoryUsage: memory.usedJSHeapSize,
                }));
            }
        };

        const interval = setInterval(trackMemoryUsage, 10000); // Every 10 seconds
        return () => clearInterval(interval);
    }, []);

    // Performance reporting
    const reportMetrics = () => {
        const report = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            webVitals,
            metrics,
            userAgent: navigator.userAgent,
            connection: (navigator as any).connection?.effectiveType || 'unknown',
        };

        // Send to analytics service (in production)
        console.log('Performance Report:', report);

        // You could send this to your analytics service
        // analytics.track('performance_metrics', report);

        return report;
    };

    return {
        webVitals,
        metrics,
        reportMetrics,
    };
};

// Performance budget hook
export const usePerformanceBudget = (budgets: {
    maxBundleSize?: number;
    maxLoadTime?: number;
    maxCLS?: number;
    maxFID?: number;
    maxLCP?: number;
}) => {
    const { webVitals, metrics } = usePerformance();
    const [violations, setViolations] = useState<string[]>([]);

    useEffect(() => {
        const newViolations: string[] = [];

        if (budgets.maxBundleSize && metrics.bundleSize > budgets.maxBundleSize) {
            newViolations.push(`Bundle size: ${Math.round(metrics.bundleSize / 1024)}KB exceeds ${Math.round(budgets.maxBundleSize / 1024)}KB limit`);
        }

        if (budgets.maxLoadTime && metrics.loadTime > budgets.maxLoadTime) {
            newViolations.push(`Load time: ${Math.round(metrics.loadTime)}ms exceeds ${budgets.maxLoadTime}ms limit`);
        }

        if (budgets.maxCLS && webVitals.cls !== null && webVitals.cls > budgets.maxCLS) {
            newViolations.push(`CLS: ${webVitals.cls.toFixed(3)} exceeds ${budgets.maxCLS} limit`);
        }

        if (budgets.maxFID && webVitals.fid !== null && webVitals.fid > budgets.maxFID) {
            newViolations.push(`FID: ${Math.round(webVitals.fid)}ms exceeds ${budgets.maxFID}ms limit`);
        }

        if (budgets.maxLCP && webVitals.lcp !== null && webVitals.lcp > budgets.maxLCP) {
            newViolations.push(`LCP: ${Math.round(webVitals.lcp)}ms exceeds ${budgets.maxLCP}ms limit`);
        }

        setViolations(newViolations);
    }, [webVitals, metrics, budgets]);

    return {
        violations,
        hasViolations: violations.length > 0,
        budgets,
    };
};

// Resource loading performance hook
export const useResourceTiming = (resourceUrl?: string) => {
    const [timing, setTiming] = useState<PerformanceResourceTiming | null>(null);

    useEffect(() => {
        const observeResource = () => {
            if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const resourceEntry = entry as PerformanceResourceTiming;
                        if (!resourceUrl || resourceEntry.name.includes(resourceUrl)) {
                            setTiming(resourceEntry);
                        }
                    }
                });
                observer.observe({ entryTypes: ['resource'] });
            }
        };

        observeResource();
    }, [resourceUrl]);

    return timing;
};

// Bundle analysis hook
export const useBundleAnalysis = () => {
    const [bundles, setBundles] = useState<{ name: string; size: number; gzipSize?: number }[]>([]);

    useEffect(() => {
        // Analyze loaded bundles from performance entries
        const analyzeBundles = () => {
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const jsBundles = resources
                .filter(entry => entry.name.includes('.js'))
                .map(entry => ({
                    name: entry.name.split('/').pop() || entry.name,
                    size: entry.transferSize || entry.decodedBodySize || 0,
                    gzipSize: entry.decodedBodySize ? Math.round(entry.decodedBodySize * 0.3) : undefined, // Rough gzip estimate
                }))
                .sort((a, b) => b.size - a.size);

            setBundles(jsBundles);
        };

        window.addEventListener('load', analyzeBundles);
        return () => window.removeEventListener('load', analyzeBundles);
    }, []);

    return bundles;
};

export default usePerformance;
