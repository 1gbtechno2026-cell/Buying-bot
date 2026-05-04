import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import dbConnect from "@/lib/db/connect";
import Job from "@/lib/db/models/Job";
import { getOrderReportsDir } from "@/lib/orderReports";
import * as fs from "fs/promises";
import * as path from "path";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

// GET /api/jobs/[jobId]/report — stream this job's CSV.
//   On disk: order-reports/job-<jobId>.csv (tab-separated).
//   Served as: orders-job-<jobId>.tsv so spreadsheet apps parse columns.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const { jobId } = await params;
  const userId = (session.user as { id: string }).id;

  // Mongo ObjectId is 24 hex chars — also defends against path traversal.
  if (!/^[a-f0-9]{24}$/i.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  // Ownership check
  const job = await Job.findOne({ _id: jobId, userId }).select("_id").lean();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const dir = getOrderReportsDir();
  const file = path.join(dir, `job-${jobId}.csv`);
  const dirReal = path.resolve(dir);
  const fileReal = path.resolve(file);
  if (!fileReal.startsWith(dirReal + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let body: string;
  try {
    body = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "No report yet — run at least one iteration to generate the CSV" },
        { status: 404 }
      );
    }
    console.error("Failed to read job report:", err);
    return NextResponse.json({ error: "Failed to read report" }, { status: 500 });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-job-${jobId}.tsv"`,
      "Cache-Control": "no-store",
    },
  });
}
