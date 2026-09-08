import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getWords } from "@/lib/words";

export async function GET() {
  const words = getWords();
  const db = await getDb();
  const progress = db.collection("progress");

  const nowIso = new Date().toISOString();
  const [dueGap, duePron, seenGap, seenPron] = await Promise.all([
    progress.countDocuments({ mode: "gap", nextDueAt: { $lte: nowIso } }),
    progress.countDocuments({ mode: "pron", nextDueAt: { $lte: nowIso } }),
    progress.countDocuments({ mode: "gap" }),
    progress.countDocuments({ mode: "pron" }),
  ]);

  return NextResponse.json({
    total: words.length,
    gapEligible: words.filter((w) => w.blankOk).length,
    dueGap,
    duePron,
    seenGap,
    seenPron,
  });
}
