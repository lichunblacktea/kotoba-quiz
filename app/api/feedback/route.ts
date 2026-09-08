import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export async function POST(req: NextRequest) {
  const { wordNo, word, sentence, note } = (await req.json()) as {
    wordNo: number;
    word: string;
    sentence: string;
    note: string;
  };

  if (!note || !note.trim()) {
    return NextResponse.json({ error: "Note is required" }, { status: 400 });
  }

  const db = await getDb();
  await db.collection("feedback").insertOne({
    wordNo,
    word,
    sentence,
    note: note.trim(),
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
