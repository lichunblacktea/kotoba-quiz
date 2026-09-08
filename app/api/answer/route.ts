import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

const BOX_DAYS = [0, 1, 3, 7, 14, 30];

interface ProgressDoc {
  wordId: number;
  mode: string;
  box: number;
}

export async function POST(req: NextRequest) {
  const { wordId, mode, correct } = (await req.json()) as {
    wordId: number;
    mode: "gap" | "pron";
    correct: boolean;
  };

  const db = await getDb();
  const progress = db.collection<ProgressDoc>("progress");

  const existing = await progress.findOne({ wordId, mode });
  const prevBox = existing?.box ?? 0;
  const nextBox = correct ? Math.min(prevBox + 1, BOX_DAYS.length - 1) : 0;
  const nextDueAt = new Date(Date.now() + BOX_DAYS[nextBox] * 86_400_000).toISOString();

  await progress.updateOne(
    { wordId, mode },
    {
      $set: { wordId, mode, box: nextBox, nextDueAt, lastSeenAt: new Date().toISOString() },
      $inc: { timesSeen: 1, timesCorrect: correct ? 1 : 0 },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}
