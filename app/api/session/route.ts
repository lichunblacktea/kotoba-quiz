import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getWords, WordEntry } from "@/lib/words";

interface ProgressDoc {
  wordId: number;
  mode: string;
  timesSeen: number;
  nextDueAt: string;
}

interface PoolEntry extends WordEntry {
  timesSeen: number;
  pool: "due" | "new" | "later";
}

interface FavoriteDoc {
  _id: number;
  favoritedAt: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Efraimidis-Spirakis weighted sampling without replacement: each item gets a key
// ln(u)/weight (u ~ Uniform(0,1)); taking the k largest keys picks k items such that
// higher-weight items are proportionally more likely to be chosen. Used here so
// words seen fewer times are more likely to come up than heavily-drilled ones.
function weightedSample<T>(pool: T[], k: number, weightOf: (item: T) => number): T[] {
  if (k <= 0) return [];
  if (pool.length <= k) return pool.slice();
  const keyed = pool.map((item) => {
    const u = Math.max(Math.random(), Number.EPSILON);
    return { item, key: Math.log(u) / weightOf(item) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.item);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") === "pron" ? "pron" : "gap";
  const count = Math.max(1, Math.min(50, Number(searchParams.get("count")) || 10));
  // Minimum share of a session reserved for never-attempted words, so a backlog of
  // due (often wrong-answered) words can't crowd out variety entirely.
  const newRatioParam = searchParams.get("newRatio");
  const newRatioPct = newRatioParam !== null && Number.isFinite(Number(newRatioParam)) ? Number(newRatioParam) : 50;
  const newRatio = Math.max(0, Math.min(100, newRatioPct)) / 100;

  const words = getWords().filter((w) => (mode === "gap" ? w.blankOk : w.hasKanji));

  const db = await getDb();
  const [progressDocs, favoriteDocs] = await Promise.all([
    db
      .collection<ProgressDoc>("progress")
      .find({ mode }, { projection: { wordId: 1, timesSeen: 1, nextDueAt: 1 } })
      .toArray(),
    db.collection<FavoriteDoc>("favorites").find({}, { projection: { _id: 1 } }).toArray(),
  ]);
  const progressByWordId = new Map(progressDocs.map((p) => [p.wordId, p]));
  const favoriteIds = new Set(favoriteDocs.map((d) => d._id));

  const nowIso = new Date().toISOString();
  const pooled: PoolEntry[] = words.map((w) => {
    const p = progressByWordId.get(w.id);
    const pool: PoolEntry["pool"] = !p ? "new" : p.nextDueAt <= nowIso ? "due" : "later";
    return { ...w, timesSeen: p?.timesSeen ?? 0, pool };
  });

  const duePool = pooled.filter((r) => r.pool === "due");
  const newPool = pooled.filter((r) => r.pool === "new");
  const laterPool = pooled.filter((r) => r.pool === "later");

  let newTarget = Math.min(newPool.length, Math.round(count * newRatio));
  let dueTarget = Math.min(duePool.length, count - newTarget);
  let laterTarget = Math.min(laterPool.length, count - newTarget - dueTarget);

  // backfill from whichever pool still has spare capacity if the others came up short
  let remaining = count - newTarget - dueTarget - laterTarget;
  if (remaining > 0) {
    const extra = Math.min(duePool.length - dueTarget, remaining);
    dueTarget += extra; remaining -= extra;
  }
  if (remaining > 0) {
    const extra = Math.min(newPool.length - newTarget, remaining);
    newTarget += extra; remaining -= extra;
  }
  if (remaining > 0) {
    laterTarget = Math.min(laterPool.length, laterTarget + remaining);
  }

  const weightOf = (r: PoolEntry) => 1 / (1 + r.timesSeen);
  const chosen = [
    ...weightedSample(duePool, dueTarget, weightOf),
    ...weightedSample(newPool, newTarget, weightOf),
    ...weightedSample(laterPool, laterTarget, weightOf),
  ];
  const selected = shuffle(chosen);

  const readingPool = getWords().map((w) => w.reading);

  const questions = selected.map((w) => {
    if (mode === "gap") {
      const distractors = shuffle(readingPool.filter((r) => r !== w.reading)).slice(0, 3);
      const choices = shuffle([w.reading, ...distractors]);
      return {
        wordId: w.id,
        wordNo: w.wordNo,
        word: w.word,
        reading: w.reading,
        sentence: w.sentence,
        blankPre: w.blankPre,
        blank: w.blank,
        blankPost: w.blankPost,
        choices,
        isFavorite: favoriteIds.has(w.id),
      };
    }
    return {
      wordId: w.id,
      wordNo: w.wordNo,
      word: w.word,
      reading: w.reading,
      sentence: w.sentence,
      isFavorite: favoriteIds.has(w.id),
    };
  });

  return NextResponse.json({ mode, questions });
}
