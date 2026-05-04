import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import { getOrderReportsDir, REPORT_DATE_RE } from "@/lib/orderReports";
import * as fs from "fs/promises";
import * as path from "path";

interface RouteParams {
  params: Promise<{ date: string }>;
}

// GET /api/reports/[date] — stream a single YYYY-MM-DD.csv file as a download.
export async function GET(_req: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { date } = await params;

  // Strict shape check — also blocks "../" and absolute paths.
  if (!REPORT_DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const dir = getOrderReportsDir();
  const file = path.join(dir, `${date}.csv`);

  // Defense in depth: confirm the resolved path is still inside the reports dir.
  const dirReal = path.resolve(dir);
  const fileReal = path.resolve(file);
  if (!fileReal.startsWith(dirReal + path.sep) && fileReal !== dirReal) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let body: string;
  try {
    body = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    console.error("Failed to read report:", err);
    return NextResponse.json({ error: "Failed to read report" }, { status: 500 });
  }

  // The on-disk file is tab-separated even though it has a .csv extension.
  // Send it as TSV so Excel / other tools parse columns correctly.
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${date}.tsv"`,
      "Cache-Control": "no-store",
    },
  });
}
