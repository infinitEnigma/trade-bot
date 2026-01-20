/** @format */

import { useEffect, useState } from "react";

interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
}

// Chrome memory API
interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceMemory extends Performance {
  memory: MemoryInfo;
}

export const useMemoryMonitor = (enabled: boolean = true) => {
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    if (!enabled || !(performance as PerformanceMemory).memory) return;

    const updateMemoryStats = () => {
      const mem = (performance as PerformanceMemory).memory;
      const stats = {
        heapUsed: mem.usedJSHeapSize,
        heapTotal: mem.totalJSHeapSize,
        external: mem.jsHeapSizeLimit,
        heapUsedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
        heapTotalMB: Math.round(mem.totalJSHeapSize / 1024 / 1024),
        externalMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
      };
      setMemoryStats(stats);

      console.log(
        `🧠 Memory: ${stats.heapUsedMB}MB used, ${stats.heapTotalMB}MB total, ${stats.externalMB}MB limit`
      );
    };

    // Update memory stats every 30 seconds
    const interval = setInterval(updateMemoryStats, 30000);
    updateMemoryStats(); // Initial update

    return () => clearInterval(interval);
  }, [enabled]);

  return memoryStats;
};
