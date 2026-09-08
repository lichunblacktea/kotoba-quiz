"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "gap" | "pron";
type Tab = "settings" | "quiz" | "history";
type QuizStage = "empty" | "loading" | "active" | "summary";

const COUNT_STOPS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const NEW_RATIO_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface GapQuestion {
  wordId: number;
  wordNo: number;
  word: string;
  reading: string;
  sentence: string;
  blankPre: string;
  blank: string;
  blankPost: string;
  choices: string[];
}
interface PronQuestion {
  wordId: number;
  wordNo: number;
  word: string;
  reading: string;
  sentence: string;
}
type Question = GapQuestion | PronQuestion;

interface ResultRow {
  wordNo: number;
  word: string;
  sentence: string;
  your: string;
  correct: string;
  ok: boolean;
}

interface Stats {
  total: number;
  gapEligible: number;
  dueGap: number;
  duePron: number;
  seenGap: number;
  seenPron: number;
}

const MOD_FAMILIES: string[][] = [
  ["か", "が"], ["き", "ぎ"], ["く", "ぐ"], ["け", "げ"], ["こ", "ご"],
  ["さ", "ざ"], ["し", "じ"], ["す", "ず"], ["せ", "ぜ"], ["そ", "ぞ"],
  ["た", "だ"], ["ち", "ぢ"], ["つ", "づ", "っ"], ["て", "で"], ["と", "ど"],
  ["は", "ば", "ぱ"], ["ひ", "び", "ぴ"], ["ふ", "ぶ", "ぷ"], ["へ", "べ", "ぺ"], ["ほ", "ぼ", "ぽ"],
  ["や", "ゃ"], ["ゆ", "ゅ"], ["よ", "ょ"],
  ["あ", "ぁ"], ["い", "ぃ"], ["う", "ぅ"], ["え", "ぇ"], ["お", "ぉ"],
  ["わ", "ゎ"],
];
const MOD_LOOKUP: Record<string, { family: string[]; idx: number }> = {};
MOD_FAMILIES.forEach((family) => family.forEach((ch, idx) => { MOD_LOOKUP[ch] = { family, idx }; }));

type PhoneKey = { role: "row"; chars: string } | { role: "mod" | "del"; main: string; sub: string };
const PHONE_GRID: PhoneKey[] = [
  { role: "row", chars: "あいうえお" }, { role: "row", chars: "かきくけこ" }, { role: "row", chars: "さしすせそ" },
  { role: "row", chars: "たちつてと" }, { role: "row", chars: "なにぬねの" }, { role: "row", chars: "はひふへほ" },
  { role: "row", chars: "まみむめも" }, { role: "row", chars: "やゆよ" }, { role: "row", chars: "らりるれろ" },
  { role: "mod", main: "゛゜", sub: "濁音・小" }, { role: "row", chars: "わをん" }, { role: "del", main: "⌫", sub: "削除" },
];

const MODE_LABEL: Record<Mode, string> = { gap: "Fill-in-the-gap", pron: "Pronunciation" };

interface ReadingSegment { blank: boolean; text: string }
const KANA_RE = /^[ぁ-んゔ]$/;

// Strips the hiragana that trails (or, rarely, leads) the kanji in `word` from `reading`,
// since that part of the reading is already visible in the word itself — no need to type it.
// Only the unambiguous leading/trailing runs are stripped; interior okurigana (compound
// verbs like 落ち着く) is left inside the blank rather than risk a wrong split.
function computeReadingSegments(word: string, reading: string): ReadingSegment[] {
  const w = Array.from(word);
  const r = Array.from(reading);

  let suffixLen = 0;
  while (
    suffixLen < w.length &&
    suffixLen < r.length &&
    KANA_RE.test(w[w.length - 1 - suffixLen]) &&
    w[w.length - 1 - suffixLen] === r[r.length - 1 - suffixLen]
  ) suffixLen++;

  const maxPrefix = Math.min(w.length - suffixLen, r.length - suffixLen);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && KANA_RE.test(w[prefixLen]) && w[prefixLen] === r[prefixLen]) prefixLen++;

  const segs: ReadingSegment[] = [];
  if (prefixLen > 0) segs.push({ blank: false, text: r.slice(0, prefixLen).join("") });
  segs.push({ blank: true, text: r.slice(prefixLen, r.length - suffixLen).join("") });
  if (suffixLen > 0) segs.push({ blank: false, text: r.slice(r.length - suffixLen).join("") });
  return segs;
}

function buildAttempt(segments: ReadingSegment[], typed: string): string {
  let idx = 0;
  return segments
    .map((seg) => {
      if (!seg.blank) return seg.text;
      const part = typed.slice(idx, idx + seg.text.length);
      idx += seg.text.length;
      return part;
    })
    .join("");
}

export default function QuizApp() {
  const [activeTab, setActiveTab] = useState<Tab>("settings");
  const [mode, setMode] = useState<Mode>("gap");
  const [quizStage, setQuizStage] = useState<QuizStage>("empty");
  const [count, setCount] = useState(10);
  const [newRatio, setNewRatio] = useState(50);
  const [reveal, setReveal] = useState(true);
  const [session, setSession] = useState<Question[]>([]);
  const [pos, setPos] = useState(0);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  async function startSession() {
    setActiveTab("quiz");
    setQuizStage("loading");
    const res = await fetch(`/api/session?mode=${mode}&count=${count}&newRatio=${newRatio}`);
    const data = await res.json();
    setSession(data.questions);
    setPos(0);
    setScore(0);
    setResults([]);
    setQuizStage("active");
  }

  function handleAnswered(row: ResultRow, wordId: number) {
    setResults((prev) => [...prev, row]);
    if (row.ok) setScore((s) => s + 1);
    fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId, mode, correct: row.ok }),
    }).catch(() => {});
  }

  function advance() {
    const next = pos + 1;
    setPos(next);
    if (next >= session.length) {
      setQuizStage("summary");
      loadStats();
    }
  }

  const current = session[pos];

  return (
    <div className="shell">
      <div>
        <div className="eyebrow">JLPT N2 &middot; 語彙 Vocabulary</div>
        <h1>Kotoba Quiz</h1>
        <p className="sub">
          Practice from your 絕對合格單字N2清單 list. Missed words come back sooner &mdash; progress
          persists between sessions.
        </p>
      </div>

      {stats && (
        <div className="stats-bar">
          <div className="stat"><span className="stat-value">{stats.total}</span><span className="stat-label">Words</span></div>
          <div className="stat"><span className="stat-value">{stats.dueGap}</span><span className="stat-label">Gap due</span></div>
          <div className="stat"><span className="stat-value">{stats.duePron}</span><span className="stat-label">Pron due</span></div>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="View">
        <button className="tab" role="tab" aria-selected={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          <span className="jp">設定</span>Settings
        </button>
        <button className="tab" role="tab" aria-selected={activeTab === "quiz"} onClick={() => setActiveTab("quiz")}>
          <span className="jp">クイズ</span>Quiz
        </button>
        <button className="tab" role="tab" aria-selected={activeTab === "history"} onClick={() => setActiveTab("history")}>
          <span className="jp">履歴</span>History
        </button>
      </div>

      <div className="card">
        {activeTab === "settings" && (
          <SettingsView
            mode={mode}
            setMode={setMode}
            count={count}
            reveal={reveal}
            newRatio={newRatio}
            setCount={setCount}
            setReveal={setReveal}
            setNewRatio={setNewRatio}
            onStart={startSession}
          />
        )}

        {activeTab === "quiz" && quizStage === "empty" && (
          <EmptyQuizView onGoToSettings={() => setActiveTab("settings")} />
        )}

        {activeTab === "quiz" && quizStage === "loading" && (
          <div className="loading">Loading questions&hellip;</div>
        )}

        {activeTab === "quiz" && quizStage === "active" && current && (
          <>
            <Header mode={mode} pos={pos} total={session.length} score={score} reveal={reveal} />
            {mode === "gap" ? (
              <GapQuestionView
                key={current.wordId}
                q={current as GapQuestion}
                reveal={reveal}
                onAnswered={(row) => handleAnswered(row, current.wordId)}
                onAdvance={advance}
              />
            ) : (
              <PronQuestionView
                key={current.wordId}
                q={current as PronQuestion}
                reveal={reveal}
                onAnswered={(row) => handleAnswered(row, current.wordId)}
                onAdvance={advance}
              />
            )}
          </>
        )}

        {activeTab === "quiz" && quizStage === "summary" && (
          <SummaryView
            mode={mode}
            score={score}
            total={session.length}
            results={results}
            onChangeSettings={() => setActiveTab("settings")}
            onRestart={startSession}
          />
        )}

        {activeTab === "history" && <HistoryView />}
      </div>

      <footer>{stats ? `${stats.total.toLocaleString()} words · N2 · 絕對合格單字N2清單` : ""}</footer>
    </div>
  );
}

function Header({ mode, pos, total, score, reveal }: { mode: Mode; pos: number; total: number; score: number; reveal: boolean }) {
  const n = Math.min(pos + 1, total);
  return (
    <>
      <div className="card-head">
        <span className="mode-name">{MODE_LABEL[mode]}</span>
        <span>Q{n}/{total}{reveal ? ` · Score ${score}/${total}` : ""}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${(pos / total) * 100}%` }} /></div>
    </>
  );
}

function CountSlider({ count, setCount }: { count: number; setCount: (n: number) => void }) {
  const idx = Math.max(0, COUNT_STOPS.indexOf(count));
  return (
    <div className="slider-block">
      <div className="slider-value">{count} question{count === 1 ? "" : "s"}</div>
      <input
        type="range"
        className="count-slider"
        min={0}
        max={COUNT_STOPS.length - 1}
        step={1}
        value={idx}
        onChange={(e) => setCount(COUNT_STOPS[Number(e.target.value)])}
        aria-label="Number of questions"
      />
      <div className="slider-ticks"><span>1</span><span>50</span></div>
    </div>
  );
}

function NewRatioSlider({ newRatio, setNewRatio }: { newRatio: number; setNewRatio: (n: number) => void }) {
  const idx = Math.max(0, NEW_RATIO_STOPS.indexOf(newRatio));
  return (
    <div className="slider-block">
      <div className="slider-value">{newRatio}% new words</div>
      <input
        type="range"
        className="count-slider"
        min={0}
        max={NEW_RATIO_STOPS.length - 1}
        step={1}
        value={idx}
        onChange={(e) => setNewRatio(NEW_RATIO_STOPS[Number(e.target.value)])}
        aria-label="Share of session reserved for new words"
      />
      <div className="slider-ticks"><span>0%</span><span>100%</span></div>
    </div>
  );
}

function SettingsView({
  mode, setMode, count, reveal, newRatio, setCount, setReveal, setNewRatio, onStart,
}: {
  mode: Mode; setMode: (m: Mode) => void; count: number; reveal: boolean; newRatio: number;
  setCount: (n: number) => void; setReveal: (b: boolean) => void; setNewRatio: (n: number) => void; onStart: () => void;
}) {
  return (
    <>
      <div className="prompt-label">Mode</div>
      <div className="setup-choices">
        <button type="button" className={`choice ${mode === "gap" ? "selected" : ""}`} onClick={() => setMode("gap")}>
          <span className="jp">穴埋め</span>Fill-in-gap
        </button>
        <button type="button" className={`choice ${mode === "pron" ? "selected" : ""}`} onClick={() => setMode("pron")}>
          <span className="jp">発音</span>Pronunciation
        </button>
      </div>
      <div className="prompt-label">How many questions?</div>
      <CountSlider count={count} setCount={setCount} />
      <div className="prompt-label">Minimum share of never-seen words</div>
      <NewRatioSlider newRatio={newRatio} setNewRatio={setNewRatio} />
      <div className="prompt-label">After you submit an answer</div>
      <div className="setup-choices">
        <button type="button" className={`choice ${reveal ? "selected" : ""}`} onClick={() => setReveal(true)}>
          Check each answer as I go
        </button>
        <button type="button" className={`choice ${!reveal ? "selected" : ""}`} onClick={() => setReveal(false)}>
          No feedback &mdash; just review at the end
        </button>
      </div>
      <div className="btn-row"><button type="button" className="btn primary" onClick={onStart}>Start Quiz</button></div>
    </>
  );
}

function EmptyQuizView({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="summary">
      <div className="prompt-label">No quiz running yet</div>
      <p className="sub empty-sub">Choose a mode and question count in Settings, then start a quiz.</p>
      <div className="btn-row"><button type="button" className="btn primary" onClick={onGoToSettings}>Go to Settings</button></div>
    </div>
  );
}

function GapQuestionView({
  q, reveal, onAnswered, onAdvance,
}: {
  q: GapQuestion; reveal: boolean;
  onAnswered: (row: ResultRow) => void; onAdvance: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState(false);

  function pick(val: string) {
    if (answered) return;
    const ok = val === q.reading;
    setAnswered(true);
    setSelected(val);
    setIsCorrect(ok);
    onAnswered({ wordNo: q.wordNo, word: q.word, sentence: q.sentence, your: val, correct: q.reading, ok });
    if (!(reveal && !ok)) setTimeout(onAdvance, 1000);
  }

  const blankText = !answered ? "＿＿＿＿" : reveal ? q.blank : "・・・・";
  const blankClass = `blank ${answered ? "filled" : ""} ${answered && reveal ? (isCorrect ? "correct" : "wrong") : ""}`;
  const feedbackClass = `feedback ${answered && reveal ? (isCorrect ? "correct" : "wrong") : ""}`;
  const feedbackText = !answered ? "" : reveal ? (isCorrect ? "Correct." : `Not quite — correct answer: ${q.reading}`) : "Answer recorded.";

  return (
    <>
      <div className="prompt-label">Choose the reading that fills the blank</div>
      <div className="prompt-sentence">
        {q.blankPre}<span className={blankClass}>{blankText}</span>{q.blankPost}
      </div>
      <div className={feedbackClass}>{feedbackText}</div>
      <div className="choices">
        {q.choices.map((c) => {
          let cls = "choice";
          if (answered && reveal) {
            if (c === q.reading) cls += " correct";
            else if (c === selected) cls += " wrong";
          }
          return (
            <button key={c} type="button" className={cls} disabled={answered} onClick={() => pick(c)}>
              {c}
            </button>
          );
        })}
      </div>
      <div className="btn-row">
        {answered && reveal && !isCorrect && (
          <button type="button" className="btn primary" onClick={onAdvance}>Next</button>
        )}
      </div>
    </>
  );
}

function PronQuestionView({
  q, reveal, onAnswered, onAdvance,
}: {
  q: PronQuestion; reveal: boolean;
  onAnswered: (row: ResultRow) => void; onAdvance: () => void;
}) {
  const segments = useMemo(() => computeReadingSegments(q.word, q.reading), [q.word, q.reading]);
  const expected = useMemo(() => segments.filter((s) => s.blank).map((s) => s.text).join(""), [segments]);
  const n = expected.length;
  const [typed, setTyped] = useState("");
  const [lastKeyChars, setLastKeyChars] = useState<string | null>(null);
  const [cyclePos, setCyclePos] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const cycleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (cycleTimer.current) clearTimeout(cycleTimer.current); }, []);

  function endCycle() {
    if (cycleTimer.current) clearTimeout(cycleTimer.current);
    setLastKeyChars(null);
  }

  function pressRow(chars: string) {
    if (answered) return;
    if (cycleTimer.current) clearTimeout(cycleTimer.current);
    if (lastKeyChars === chars && typed.length > 0) {
      const next = (cyclePos + 1) % chars.length;
      setCyclePos(next);
      setTyped(typed.slice(0, -1) + chars[next]);
    } else {
      if (typed.length >= n) return;
      setLastKeyChars(chars);
      setCyclePos(0);
      setTyped(typed + chars[0]);
    }
    cycleTimer.current = setTimeout(() => setLastKeyChars(null), 900);
  }

  function pressMod() {
    if (answered || typed.length === 0) return;
    endCycle();
    const chars = Array.from(typed);
    const last = chars[chars.length - 1];
    const mod = MOD_LOOKUP[last];
    if (!mod) return;
    chars[chars.length - 1] = mod.family[(mod.idx + 1) % mod.family.length];
    setTyped(chars.join(""));
  }

  function pressDel() {
    if (answered) return;
    endCycle();
    setTyped(typed.slice(0, -1));
  }

  function clearAll() {
    if (answered) return;
    endCycle();
    setTyped("");
  }

  function submit() {
    if (answered) return;
    endCycle();
    const ok = typed === expected;
    onAnswered({ wordNo: q.wordNo, word: q.word, sentence: q.sentence, your: buildAttempt(segments, typed), correct: q.reading, ok });
    if (reveal) {
      setAnswered(true);
      setIsCorrect(ok);
    } else {
      // No feedback to show, so there's nothing to pause on — checking and
      // advancing are the same action here, so one click does both.
      onAdvance();
    }
  }

  const chars = Array.from(typed);
  const feedbackClass = `feedback ${answered && reveal ? (isCorrect ? "correct" : "wrong") : ""}`;
  const feedbackText = !answered ? "" : reveal ? (isCorrect ? "Correct." : `Not quite — correct answer: ${q.reading}`) : "Answer recorded.";

  type Cell = { kind: "fixed"; key: string; text: string } | { kind: "box"; key: string; idx: number };
  let blankIdx = 0;
  const cells: Cell[] = segments.flatMap((seg, si): Cell[] => {
    if (!seg.blank) return [{ kind: "fixed", key: `f${si}`, text: seg.text }];
    return Array.from(seg.text).map((_, ci) => ({ kind: "box", key: `b${si}-${ci}`, idx: blankIdx++ }));
  });

  return (
    <>
      <div className="prompt-label">Fill in the missing reading &middot; {n} character{n === 1 ? "" : "s"}</div>
      <div className="prompt-word">{q.word}</div>
      <div className="char-boxes">
        {cells.map((cell) =>
          cell.kind === "fixed" ? (
            <span key={cell.key} className="kana-fixed">{cell.text}</span>
          ) : (
            <div
              key={cell.key}
              className={`char-box ${chars[cell.idx] ? "filled" : ""} ${answered && reveal ? (isCorrect ? "correct" : "wrong") : ""}`}
            >
              {chars[cell.idx] || ""}
            </div>
          )
        )}
      </div>
      <div className="phone-pad">
        {PHONE_GRID.map((key, i) => {
          if (key.role === "mod") {
            return (
              <button key={i} type="button" className="phone-key" disabled={answered} onClick={pressMod}>
                <span className="pk-main">{key.main}</span><span className="pk-sub">{key.sub}</span>
              </button>
            );
          }
          if (key.role === "del") {
            return (
              <button key={i} type="button" className="phone-key" disabled={answered} onClick={pressDel}>
                <span className="pk-main">{key.main}</span><span className="pk-sub">{key.sub}</span>
              </button>
            );
          }
          if (key.role !== "row") return null;
          const chars = key.chars;
          return (
            <button
              key={i}
              type="button"
              className={`phone-key ${lastKeyChars === chars ? "active" : ""}`}
              disabled={answered}
              onClick={() => pressRow(chars)}
            >
              <span className="pk-main">{chars[0]}</span>
              <span className="pk-sub">{chars.slice(1)}</span>
            </button>
          );
        })}
      </div>
      <div className={feedbackClass}>{feedbackText}</div>
      <div className="btn-row">
        {!answered ? (
          <>
            <button type="button" className="btn" onClick={clearAll}>Clear</button>
            <button type="button" className="btn primary" onClick={submit}>{reveal ? "Check" : "Next"}</button>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={onAdvance}>Next</button>
        )}
      </div>
    </>
  );
}

function SummaryView({
  mode, score, total, results, onChangeSettings, onRestart,
}: {
  mode: Mode; score: number; total: number; results: ResultRow[];
  onChangeSettings: () => void; onRestart: () => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sentIdx, setSentIdx] = useState<number[]>([]);

  function toggleReport(i: number) {
    setOpenIdx(openIdx === i ? null : i);
    setNote("");
  }

  async function sendFeedback(i: number) {
    if (!note.trim()) return;
    const r = results[i];
    setSending(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordNo: r.wordNo, word: r.word, sentence: r.sentence, note }),
      });
      setSentIdx((prev) => [...prev, i]);
      setOpenIdx(null);
    } catch {
      // best-effort; user can just try again
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="card-head"><span className="mode-name">{MODE_LABEL[mode]}</span></div>
      <div className="summary">
        <div className="prompt-label">Session complete</div>
        <div className="score">{score} / {total}</div>
      </div>
      <div className="board-head">
        <span>#</span><span>No.</span><span>Word</span><span>Your answer</span><span>Correct</span><span></span><span></span>
      </div>
      <div className="board">
        {results.map((r, i) => (
          <div key={i} className="board-item">
            <div className={`board-row ${r.ok ? "ok" : "bad"}`}>
              <span className="board-i">{i + 1}</span>
              <span className="board-no">{r.wordNo}</span>
              <span className="board-word">{r.word}</span>
              <span className="board-your">{r.your || "—"}</span>
              <span className="board-correct">{r.correct}</span>
              <span className="board-mark">{r.ok ? "✓" : "✗"}</span>
              <button
                type="button"
                className="report-btn"
                title={sentIdx.includes(i) ? "Feedback sent" : "Report an issue with this word"}
                disabled={sentIdx.includes(i)}
                onClick={() => toggleReport(i)}
              >
                {sentIdx.includes(i) ? "✓" : "⚑"}
              </button>
            </div>
            {openIdx === i && (
              <div className="report-panel">
                <div className="report-word">{r.word}</div>
                <div className="report-sentence">{r.sentence}</div>
                <textarea
                  className="report-input"
                  rows={3}
                  placeholder="What's wrong with this word or sentence?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="btn-row">
                  <button type="button" className="btn" onClick={() => setOpenIdx(null)}>Cancel</button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={sending || !note.trim()}
                    onClick={() => sendFeedback(i)}
                  >
                    {sending ? "Sending…" : "Submit"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onChangeSettings}>Change settings</button>
        <button type="button" className="btn primary" onClick={onRestart}>Play again</button>
      </div>
    </>
  );
}

interface WordAccuracy {
  wordId: number;
  wordNo: number;
  word: string;
  reading: string;
  seen: number;
  correct: number;
  rate: number;
}
interface HistoryData {
  mode: Mode;
  wordsAttempted: number;
  totalAnswers: number;
  totalCorrect: number;
  words: WordAccuracy[];
}

function HistoryView() {
  const [mode, setMode] = useState<Mode>("gap");
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/history?mode=${mode}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [mode]);

  const overallRate = data && data.totalAnswers > 0 ? Math.round((data.totalCorrect / data.totalAnswers) * 100) : 0;

  return (
    <>
      <div className="mode-toggle" role="tablist" aria-label="History mode">
        <button type="button" className="mode-btn" role="tab" aria-selected={mode === "gap"} onClick={() => setMode("gap")}>
          <span className="jp">穴埋め</span>Fill-in-gap
        </button>
        <button type="button" className="mode-btn" role="tab" aria-selected={mode === "pron"} onClick={() => setMode("pron")}>
          <span className="jp">発音</span>Pronunciation
        </button>
      </div>

      {!data ? (
        <div className="loading">Loading history&hellip;</div>
      ) : (
        <>
          <div className="summary">
            <div className="prompt-label">Words practiced &middot; {MODE_LABEL[mode]}</div>
            <div className="score">{data.wordsAttempted}</div>
            <div className="sub">{data.totalCorrect} / {data.totalAnswers} correct &middot; {overallRate}%</div>
          </div>
          {data.words.length === 0 ? (
            <p className="sub empty-sub">No words practiced yet in this mode &mdash; finish a quiz to see accuracy here.</p>
          ) : (
            <>
              <div className="history-head">
                <span>No.</span><span>Word</span><span>Score</span><span>Rate</span>
              </div>
              <div className="board">
                {data.words.map((w) => {
                  const pct = Math.round(w.rate * 100);
                  const rateClass = w.rate >= 0.8 ? "good" : w.rate < 0.5 ? "poor" : "";
                  return (
                    <div key={w.wordId} className="history-row">
                      <span className="board-i">{w.wordNo}</span>
                      <span className="acc-word">
                        {w.word}
                        <span className="acc-reading">{w.reading}</span>
                      </span>
                      <span className="acc-frac">{w.correct}/{w.seen}</span>
                      <span className={`acc-rate ${rateClass}`}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
