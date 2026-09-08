import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getWordById } from "@/lib/words";

interface ProgressDoc {
  wordId: number;
  mode: string;
  timesSeen: number;
  timesCorrect: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") === "pron" ? "pron" : "gap";

  const db = await getDb();
  const progressDocs = await db.collection<ProgressDoc>("progress").find({ mode }).toArray();

  const words = progressDocs
    .map((p) => {
      const w = getWordById(p.wordId);
      if (!w) return null;
      const seen = p.timesSeen;
      const correct = p.timesCorrect;
      return {
        wordId: w.id,
        wordNo: w.wordNo,
        word: w.word,
        reading: w.reading,
        seen,
        correct,
        rate: seen > 0 ? correct / seen : 0,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  // weakest accuracy first, most-practiced first among ties, then spreadsheet order
  words.sort((a, b) => a.rate - b.rate || b.seen - a.seen || a.wordNo - b.wordNo);

  return NextResponse.json({
    mode,
    wordsAttempted: words.length,
    totalAnswers: words.reduce((sum, w) => sum + w.seen, 0),
    totalCorrect: words.reduce((sum, w) => sum + w.correct, 0),
    words,
  });
}
