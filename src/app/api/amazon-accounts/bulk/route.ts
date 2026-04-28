import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/getSession";
import dbConnect from "@/lib/db/connect";
import AmazonAccount from "@/lib/db/models/AmazonAccount";
import { encrypt } from "@/lib/encryption";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";

// POST /api/amazon-accounts/bulk — upload multiple Amazon accounts from CSV
// CSV format: email,password           or
//             email,password,label     (one per line; header row optional)
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  if (!checkRateLimit(`amazon-accounts-bulk:${userId}`, 5, 5 / 60)) {
    return rateLimitResponse();
  }

  try {
    const body = await req.json();
    const csvText = body.csv as string;

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json({ error: "Missing csv field" }, { status: 400 });
    }

    await dbConnect();

    const lines = csvText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith("email"));

    const accounts: Array<{
      userId: typeof userId;
      label: string;
      encryptedEmail: string;
      encryptedPassword: string;
    }> = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(",").map((p) => p.trim());
      const email = parts[0];
      const password = parts[1];
      const label = parts[2] || email;

      if (!email) {
        errors.push(`Row ${i + 1}: missing email`);
        continue;
      }
      if (!password) {
        errors.push(`Row ${i + 1}: missing password`);
        continue;
      }

      accounts.push({
        userId,
        label,
        encryptedEmail: encrypt(email),
        encryptedPassword: encrypt(password),
      });
    }

    let inserted = 0;
    if (accounts.length > 0) {
      const result = await AmazonAccount.insertMany(accounts);
      inserted = result.length;
    }

    return NextResponse.json({
      inserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Bulk Amazon account upload error:", error);
    return NextResponse.json(
      { error: "Failed to process CSV" },
      { status: 500 }
    );
  }
}
