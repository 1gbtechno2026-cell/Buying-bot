import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import dbConnect from "@/lib/db/connect";
import ChromeProfile from "@/lib/db/models/ChromeProfile";
import Job from "@/lib/db/models/Job";
import { getProfileDir } from "@/lib/platform/chromePaths";
import * as fs from "fs/promises";
import * as path from "path";

interface RouteParams {
  params: Promise<{ profileId: string }>;
}

// DELETE /api/profiles/[profileId] — delete a Chrome profile (DB row + on-disk
// userDataDir). Refuses while any of the user's jobs is still actively using
// this profile so we don't yank Chrome's data dir out from under a live runner.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const { profileId } = await params;
  const userId = (session.user as { id: string }).id;

  if (!/^[a-f0-9]{24}$/i.test(profileId)) {
    return NextResponse.json({ error: "Invalid profile id" }, { status: 400 });
  }

  const profile = await ChromeProfile.findOne({ _id: profileId, userId });
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Block deletion if a job using this profile is currently active.
  const liveJob = await Job.findOne({
    userId,
    chromeProfileId: profileId,
    status: { $in: ["pending", "running", "paused"] },
  })
    .select("_id status")
    .lean();
  if (liveJob) {
    return NextResponse.json(
      {
        error:
          "This profile is in use by a running or pending job. Stop or delete the job first.",
      },
      { status: 409 }
    );
  }

  // Best-effort: remove the on-disk userDataDir. Failure here doesn't stop
  // the DB delete — disk cleanup can be retried manually if needed.
  let dirRemoved = false;
  let dirError: string | undefined;
  try {
    const dir = getProfileDir(profile.directoryName);
    const dirReal = path.resolve(dir);
    const baseReal = path.resolve(
      process.env.CHROME_PROFILES_DIR || "./chrome-profiles"
    );
    // Defense: only remove paths inside the configured base directory.
    if (
      dirReal.startsWith(baseReal + path.sep) ||
      dirReal === baseReal
    ) {
      await fs.rm(dir, { recursive: true, force: true });
      dirRemoved = true;
    } else {
      dirError = `Refused to remove dir outside CHROME_PROFILES_DIR: ${dirReal}`;
    }
  } catch (err) {
    dirError = err instanceof Error ? err.message : String(err);
  }

  await ChromeProfile.deleteOne({ _id: profileId, userId });

  return NextResponse.json({
    success: true,
    dirRemoved,
    ...(dirError ? { dirWarning: dirError } : {}),
  });
}
