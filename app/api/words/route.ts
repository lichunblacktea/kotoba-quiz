import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getWords, WordEntry } from "@/lib/words";

const PAGE_SIZE = 20;

interface FavoriteDoc {
  _id: number;
  favoritedAt: string;
}
interface NoteDoc {
  _id: number;
  text: string;
  updatedAt: string;
}

function matches(w: WordEntry, query: string): boolean {
  if (/^\d+$/.test(query)) return String(w.wordNo) === query;
  return w.word.includes(query) || w.reading.includes(query);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") || "").trim();
  const favoritesOnly = searchParams.get("favoritesOnly") === "1";
  const hasNotesOnly = searchParams.get("hasNotesOnly") === "1";
  const page = Math.max(0, Math.trunc(Number(searchParams.get("page")) || 0));

  const db = await getDb();
  const [favoriteDocs, noteDocs] = await Promise.all([
    db.collection<FavoriteDoc>("favorites").find({}, { projection: { _id: 1 } }).toArray(),
    db.collection<NoteDoc>("notes").find({}, { projection: { _id: 1, text: 1 } }).toArray(),
  ]);
  const favoriteIds = new Set(favoriteDocs.map((d) => d._id));
  const notesById = new Map(noteDocs.map((d) => [d._id, d.text]));

  let words = getWords();
  if (query) words = words.filter((w) => matches(w, query));
  if (favoritesOnly) words = words.filter((w) => favoriteIds.has(w.id));
  if (hasNotesOnly) words = words.filter((w) => notesById.has(w.id));

  const total = words.length;
  const start = page * PAGE_SIZE;
  const pageWords = words.slice(start, start + PAGE_SIZE).map((w) => ({
    wordId: w.id,
    wordNo: w.wordNo,
    word: w.word,
    reading: w.reading,
    sentence: w.sentence,
    isFavorite: favoriteIds.has(w.id),
    note: notesById.get(w.id) ?? null,
  }));

  return NextResponse.json({ total, page, pageSize: PAGE_SIZE, words: pageWords });
}
