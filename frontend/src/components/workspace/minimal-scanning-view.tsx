"use client";

import { ScanningOverlay } from "@/components/workspace/scanning-overlay";
import { ScannerProgress } from "@/types/session";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function MinimalScanningView({ scanner, progressPercent }: MinimalScanningViewProps) {
  return <ScanningOverlay scanner={scanner} progressPercent={progressPercent} />;
}
