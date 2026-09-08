import fs from "node:fs";
import path from "node:path";

export interface WordEntry {
  id: number;
  trackNo: number;
  wordNo: number;
  word: string;
  reading: string;
  sentence: string;
  level: string;
  blankPre: string;
  blank: string;
  blankPost: string;
  blankOk: boolean;
  hasKanji: boolean;
  partOfSpeech?: string;
}

interface WordSeed {
  trackNo: number;
  wordNo: number;
  word: string;
  reading: string;
  sentence: string;
  level: string;
  blankPre: string;
  blank: string;
  blankPost: string;
  blankOk: boolean;
  partOfSpeech?: string;
}

const KANJI_RE = /[一-鿿㐀-䶿]/;

let cache: WordEntry[] | null = null;

// Word data is static and bundled with the app (read-only reference data, not
// user state), so it's kept as a plain in-memory array instead of a DB table —
// no round trip needed for the ~2,801-row lookup this app does on every session.
export function getWords(): WordEntry[] {
  if (cache) return cache;
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "words.json"), "utf-8");
  const seed: WordSeed[] = JSON.parse(raw);
  cache = seed.map((w, i) => ({
    id: i + 1,
    trackNo: w.trackNo,
    wordNo: w.wordNo,
    word: w.word,
    reading: w.reading,
    sentence: w.sentence,
    level: w.level,
    blankPre: w.blankPre,
    blank: w.blank,
    blankPost: w.blankPost,
    blankOk: w.blankOk,
    hasKanji: KANJI_RE.test(w.word),
    partOfSpeech: w.partOfSpeech,
  }));
  return cache;
}

let byId: Map<number, WordEntry> | null = null;
export function getWordById(id: number): WordEntry | undefined {
  if (!byId) byId = new Map(getWords().map((w) => [w.id, w]));
  return byId.get(id);
}
