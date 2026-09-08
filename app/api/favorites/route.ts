import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

interface FavoriteDoc {
  _id: number;
  favoritedAt: string;
}

export async function POST(req: NextRequest) {
  const { wordId, favorite } = (await req.json()) as { wordId: number; favorite: boolean };
  const db = await getDb();
  const favorites = db.collection<FavoriteDoc>("favorites");

  if (favorite) {
    await favorites.updateOne(
      { _id: wordId },
      { $set: { favoritedAt: new Date().toISOString() } },
      { upsert: true }
    );
  } else {
    await favorites.deleteOne({ _id: wordId });
  }

  return NextResponse.json({ ok: true });
}
