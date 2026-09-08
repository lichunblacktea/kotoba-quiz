import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

interface NoteDoc {
  _id: number;
  text: string;
  updatedAt: string;
}

export async function POST(req: NextRequest) {
  const { wordId, text } = (await req.json()) as { wordId: number; text: string };
  const db = await getDb();
  const notes = db.collection<NoteDoc>("notes");

  const trimmed = (text ?? "").trim();
  if (trimmed) {
    await notes.updateOne(
      { _id: wordId },
      { $set: { text: trimmed, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  } else {
    await notes.deleteOne({ _id: wordId });
  }

  return NextResponse.json({ ok: true });
}
