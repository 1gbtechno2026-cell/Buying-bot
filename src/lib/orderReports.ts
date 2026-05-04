import path from "path";

// Shared with automation/core/BatchOrchestrator.ts (same logic, duplicated
// inline there because the runner is spawned by tsx and avoids src/ imports).
// Override via the ORDER_REPORTS_DIR env var; defaults to <cwd>/order-reports.
export function getOrderReportsDir(): string {
  return process.env.ORDER_REPORTS_DIR || path.join(process.cwd(), "order-reports");
}

// Filename pattern produced by appendOrderToCsv: YYYY-MM-DD.csv
export const REPORT_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.csv$/;

// Validate a date string (YYYY-MM-DD) coming in from the URL.
export const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
