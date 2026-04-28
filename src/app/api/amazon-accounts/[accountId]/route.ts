import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import dbConnect from "@/lib/db/connect";
import AmazonAccount from "@/lib/db/models/AmazonAccount";

// DELETE /api/amazon-accounts/[accountId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const { accountId } = await params;
  const userId = (session.user as { id: string }).id;

  const deleted = await AmazonAccount.findOneAndDelete({ _id: accountId, userId });
  if (!deleted) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "Account deleted" });
}
