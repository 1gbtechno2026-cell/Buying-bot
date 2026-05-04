import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import { getOrderReportsDir, REPORT_FILENAME_RE } from "@/lib/orderReports";
import * as fs from "fs/promises";
import * as path from "path";

interface ReportEntry {
  date: string;
  sizeBytes: number;
  rowCount: number;
  modifiedAt: string;
}

// GET /api/reports — list every YYYY-MM-DD.csv order-report on disk.
export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dir = getOrderReportsDir();

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json([]);
    }
    console.error("Failed to read order-reports dir:", err);
    return NextResponse.json({ error: "Failed to read reports" }, { status: 500 });
  }

  const reports: ReportEntry[] = [];
  for (const name of names) {
    const m = REPORT_FILENAME_RE.exec(name);
    if (!m) continue;
    const date = m[1];
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      // Cheap row count: header + N data rows. Files are at most a few MB,
      // and re-reading is fine because the dashboard list is human-paced.
      const text = await fs.readFile(full, "utf-8");
      const lines = text.split("\n").filter((l) => l.length > 0);
      const rowCount = Math.max(0, lines.length - 1); // subtract header
      reports.push({
        date,
        sizeBytes: stat.size,
        rowCount,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (err) {
      console.warn(`Skipping report ${name}: ${(err as Error).message}`);
    }
  }

  // Newest first
  reports.sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json(reports);
}
