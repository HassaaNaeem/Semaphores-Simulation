import { useState, useEffect, useMemo, useRef } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

/* ============================================================
   SEMAPHORE VISUALIZER
   - Binary & Counting semaphores
   - Configurable resources (N) and processes (M)
   - Step-by-step playback with the matching Python line highlighted
   - Motion done with CSS transitions on absolutely-positioned cards
     (no external animation lib needed). See notes at bottom of chat
     for how to port the glide to Framer Motion's <motion.div layout/>.
   ============================================================ */

/* ---------- Python source shown in the code panels ---------- */
const SEM_CODE = {
  counting: [
    "class Semaphore:",
    "    def __init__(self, n):",
    "        self.value = n        # free resources",
    "        self.queue = []       # blocked PCBs",
    "",
    "    def wait(self, p):        # P / acquire",
    "        self.value -= 1",
    "        if self.value < 0:",
    "            self.queue.append(p)",
    "            block(p)",
    "",
    "    def signal(self):         # V / release",
    "        self.value += 1",
    "        if self.value <= 0:",
    "            w = self.queue.pop(0)",
    "            wakeup(w)",
  ],
  binary: [
    "class BinarySemaphore:",
    "    def __init__(self):",
    "        self.value = 1        # 1 = free, 0 = held",
    "        self.queue = []",
    "",
    "    def wait(self, p):        # P / acquire",
    "        if self.value == 1:",
    "            self.value = 0",
    "        else:",
    "            self.queue.append(p)",
    "            block(p)",
    "",
    "    def signal(self):         # V / release",
    "        if self.queue:",
    "            w = self.queue.pop(0)",
    "            wakeup(w)",
    "        else:",
    "            self.value = 1",
  ],
};

const PROC_CODE = [
  "def process(sem, p):",
  "    # ---- entry section ----",
  "    sem.wait(p)",
  "    # ==== CRITICAL SECTION ====",
  "    use_resource(p)",
  "    # ---- exit section ----",
  "    sem.signal()",
  "    # remainder",
];

/* ============================================================
   TIMELINE BUILDER
   Deterministic schedule: every ready process attempts wait()
   in id order (we watch acquisitions & blocks), then in-CS
   processes signal() in FIFO order, waking blocked ones.
   Returns an array of frames; the UI just indexes into it.
   ============================================================ */
function buildTimeline(type, N, M) {
  const isBin = type === "binary";
  const cap = isBin ? 1 : N;
  let S = isBin ? 1 : N;

  const st = {}; // pid -> state
  for (let p = 1; p <= M; p++) st[p] = "ready";
  let cs = []; // ids currently in critical section
  let blk = []; // ids in blocked queue
  let done = []; // ids that have left / are leaving

  const frames = [];
  const ready = () =>
    Object.keys(st)
      .map(Number)
      .filter((p) => st[p] === "ready" || st[p] === "calling_wait")
      .sort((a, b) => a - b);

  const push = (active, block, line, note) =>
    frames.push({
      S,
      cap,
      type,
      ready: ready(),
      cs: [...cs],
      blk: [...blk],
      done: [...done],
      state: { ...st },
      active,
      block,
      line,
      note,
    });

  push(
    null,
    null,
    null,
    `Ready. Semaphore S = ${S}. ${isBin ? "1 process may hold the lock." : `${N} processes may share the resource.`}`,
  );

  /* ---------------- ENTRY ROUND ---------------- */
  for (let p = 1; p <= M; p++) {
    st[p] = "calling_wait";
    push(p, "p", 2, `P${p} reaches its entry section and calls sem.wait()`);

    if (!isBin) {
      S -= 1;
      push(p, "s", 6, `wait(): S = S − 1  →  S = ${S}`);
      push(p, "s", 7, `Is S < 0 ?  (${S} < 0 → ${S < 0})`);
      if (S < 0) {
        blk.push(p);
        push(p, "s", 8, `S < 0, so P${p} is appended to the blocked queue`);
        st[p] = "blocked";
        push(p, "s", 9, `block(P${p}) — P${p} sleeps and waits its turn`);
      } else {
        st[p] = "in_cs";
        cs.push(p);
        push(
          p,
          "p",
          4,
          `S ≥ 0 → P${p} enters the CRITICAL SECTION (using a resource)`,
        );
      }
    } else {
      push(p, "s", 6, `wait(): is S == 1 ?  (S = ${S})`);
      if (S === 1) {
        S = 0;
        push(p, "s", 7, `Lock was free → set S = 0 (now held by P${p})`);
        st[p] = "in_cs";
        cs.push(p);
        push(p, "p", 4, `P${p} enters the CRITICAL SECTION`);
      } else {
        blk.push(p);
        push(p, "s", 9, `Lock is held → P${p} joins the blocked queue`);
        st[p] = "blocked";
        push(p, "s", 10, `block(P${p}) — P${p} sleeps`);
      }
    }
  }

  /* ---------------- EXIT ROUND ---------------- */
  const toExit = [...cs];
  while (toExit.length) {
    const p = toExit.shift();
    st[p] = "exiting";
    cs = cs.filter((x) => x !== p);
    done.push(p);
    push(p, "p", 6, `P${p} finished its work and calls sem.signal()`);

    if (!isBin) {
      S += 1;
      push(p, "s", 12, `signal(): S = S + 1  →  S = ${S}`);
      push(p, "s", 13, `Is S ≤ 0 ?  (${S} ≤ 0 → ${S <= 0})`);
      if (S <= 0) {
        const w = blk.shift();
        push(p, "s", 14, `A process was waiting → pop P${w} from the queue`);
        st[w] = "in_cs";
        cs.push(w);
        toExit.push(w);
        push(
          p,
          "s",
          15,
          `wakeup(P${w}) — P${w} now enters the CRITICAL SECTION`,
        );
      }
    } else {
      push(
        p,
        "s",
        13,
        `signal(): is the queue non-empty? (${blk.length} waiting)`,
      );
      if (blk.length) {
        const w = blk.shift();
        push(p, "s", 14, `Queue not empty → pop P${w}`);
        st[w] = "in_cs";
        cs.push(w);
        toExit.push(w);
        push(p, "s", 15, `wakeup(P${w}) — lock handed directly to P${w}`);
      } else {
        S = 1;
        push(p, "s", 17, `Queue empty → set S = 1 (lock released)`);
      }
    }
    st[p] = "done";
    push(p, "p", 7, `P${p} is DONE`);
  }

  push(null, null, null, "All processes complete. Semaphore restored. ✓");
  return frames;
}

/* ---------------- layout geometry ---------------- */
const STAGE_W = 720;
const CARD_W = 58,
  CARD_H = 38,
  ROW = 48;
const ZONE_TOP = 64;

const READY_X = 26;
const CS_X = 250;
const BLK_X = 636;
const CS_COLS = (cap) => Math.min(cap, 4);
const CS_SLOT_W = 78;

function slotXY(i, cap) {
  const cols = CS_COLS(cap);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: CS_X + col * CS_SLOT_W, y: ZONE_TOP + row * ROW };
}

function cardPos(frame, pid) {
  const { state, cs, blk, ready, done, cap } = frame;
  const s = state[pid];
  if (s === "in_cs") {
    const i = cs.indexOf(pid);
    return slotXY(i < 0 ? 0 : i, cap);
  }
  if (s === "blocked") {
    const i = blk.indexOf(pid);
    return { x: BLK_X, y: ZONE_TOP + i * ROW };
  }
  if (s === "exiting" || s === "done") {
    const i = done.indexOf(pid);
    return { x: 26 + (i % 9) * 64, y: stageHeight(frame) - 58 };
  }
  // ready / calling_wait
  const i = ready.indexOf(pid);
  return { x: READY_X, y: ZONE_TOP + i * ROW };
}

function stageHeight(frame) {
  const M = Object.keys(frame.state).length;
  const csRows = Math.ceil(frame.cap / CS_COLS(frame.cap));
  const colNeed = ZONE_TOP + M * ROW;
  const csNeed = ZONE_TOP + csRows * ROW;
  return Math.max(colNeed, csNeed, 320) + 78;
}

/* ---------------- small UI atoms ---------------- */
function Stepper({ label, value, set, min, max, disabled }) {
  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
      <div className="lbl">{label}</div>
      <div className="stepper">
        <button
          disabled={disabled || value <= min}
          onClick={() => set(value - 1)}
        >
          <ChevronDown size={15} />
        </button>
        <span>{value}</span>
        <button
          disabled={disabled || value >= max}
          onClick={() => set(value + 1)}
        >
          <ChevronUp size={15} />
        </button>
      </div>
    </div>
  );
}

function CodePanel({ title, lines, activeLine }) {
  return (
    <div className="code">
      <div className="code-title">{title}</div>
      <pre>
        {lines.map((ln, i) => (
          <div
            key={i}
            className={"code-line" + (i === activeLine ? " hot" : "")}
          >
            <span className="ln">{String(i + 1).padStart(2, " ")}</span>
            <span className="src">{ln || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

const STATE_COLOR = {
  ready: "var(--ready)",
  calling_wait: "var(--accent)",
  in_cs: "var(--cs)",
  blocked: "var(--blk)",
  exiting: "var(--done)",
  done: "var(--done)",
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function SemaphoreVisualizer() {
  const [type, setType] = useState("counting");
  const [N, setN] = useState(3);
  const [M, setM] = useState(5);
  const [speed, setSpeed] = useState(850);

  const cap = type === "binary" ? 1 : N;
  const frames = useMemo(() => buildTimeline(type, cap, M), [type, cap, M]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  // reset playback when configuration changes
  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [type, N, M]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    timer.current = setTimeout(
      () => setIdx((i) => Math.min(i + 1, frames.length - 1)),
      speed,
    );
    return () => clearTimeout(timer.current);
  }, [playing, idx, speed, frames.length]);

  const frame = frames[idx];
  const semLines = SEM_CODE[type];
  const semActive = frame.block === "s" ? frame.line : -1;
  const procActive = frame.block === "p" ? frame.line : -1;

  const pids = Array.from({ length: M }, (_, i) => i + 1);
  const H = stageHeight(frame);
  const blockedCount = frame.blk.length;

  const step = (d) => {
    setPlaying(false);
    setIdx((i) => Math.max(0, Math.min(frames.length - 1, i + d)));
  };

  return (
    <div className="root">
      <style>{CSS}</style>

      <header>
        <div>
          <h1>
            Semaphores<span className="dot">.</span>
          </h1>
          <p className="sub">
            A visual, line-by-line walk through process synchronization
          </p>
        </div>
        <div className="seg">
          {["binary", "counting"].map((t) => (
            <button
              key={t}
              className={type === t ? "on" : ""}
              onClick={() => setType(t)}
            >
              {t === "binary" ? "Binary" : "Counting"}
            </button>
          ))}
        </div>
      </header>

      {/* controls */}
      <div className="controls">
        <Stepper
          label={
            type === "binary" ? "Resources (locked to 1)" : "Resources  (N → S)"
          }
          value={cap}
          set={setN}
          min={1}
          max={6}
          disabled={type === "binary"}
        />
        <Stepper label="Processes" value={M} set={setM} min={2} max={8} />
        <div className="grow" />
        <div className="speed">
          <div className="lbl">Speed</div>
          <input
            type="range"
            min={250}
            max={1500}
            step={50}
            value={1750 - speed}
            onChange={(e) => setSpeed(1750 - Number(e.target.value))}
          />
        </div>
      </div>

      {/* live readout */}
      <div className="readout">
        <div className="metric">
          <span className="m-lbl">S (value)</span>
          <span className={"m-val" + (frame.S < 0 ? " neg" : "")}>
            {frame.S}
          </span>
        </div>
        <div className="metric">
          <span className="m-lbl">In critical section</span>
          <span className="m-val cs">
            {frame.cs.length}
            <i>/{cap}</i>
          </span>
        </div>
        <div className="metric">
          <span className="m-lbl">Blocked</span>
          <span className="m-val blk">{blockedCount}</span>
        </div>
        <div className="metric">
          <span className="m-lbl">Done</span>
          <span className="m-val">
            {frame.done.filter((p) => frame.state[p] === "done").length}/{M}
          </span>
        </div>
      </div>

      <div className="grid">
        {/* ---------- STAGE ---------- */}
        <div className="stage-wrap">
          <div className="stage" style={{ aspectRatio: `${STAGE_W} / ${H}` }}>
            <svg viewBox={`0 0 ${STAGE_W} ${H}`} className="stage-svg">
              {/* zone backdrops */}
              <Zone
                x={8}
                y={40}
                w={150}
                h={H - 110}
                label="READY"
                color="var(--ready)"
              />
              <Zone
                x={224}
                y={40}
                w={CS_COLS(cap) * CS_SLOT_W + 24}
                h={H - 110}
                label={`CRITICAL SECTION  ·  cap ${cap}`}
                color="var(--cs)"
              />
              <Zone
                x={616}
                y={40}
                w={96}
                h={H - 110}
                label="BLOCKED"
                color="var(--blk)"
              />
              {/* CS capacity slots */}
              {Array.from({ length: cap }).map((_, i) => {
                const { x, y } = slotXY(i, cap);
                return (
                  <rect
                    key={i}
                    x={x - 4}
                    y={y - 3}
                    width={CARD_W + 8}
                    height={CARD_H + 6}
                    rx="9"
                    className="slot"
                  />
                );
              })}
              {/* done strip baseline */}
              <line
                x1="12"
                y1={H - 66}
                x2={STAGE_W - 12}
                y2={H - 66}
                className="baseline"
              />
              <text x="14" y={H - 72} className="zone-tag" fill="var(--done)">
                DONE / REMAINDER →
              </text>
            </svg>

            {/* process cards (absolutely positioned, CSS-transition glide) */}
            {pids.map((p) => {
              const { x, y } = cardPos(frame, p);
              const s = frame.state[p];
              const isActive = frame.active === p;
              return (
                <div
                  key={p}
                  className={"card" + (isActive ? " active" : "")}
                  style={{
                    width: `${(CARD_W / STAGE_W) * 100}%`,
                    height: `${(CARD_H / H) * 100}%`,
                    left: `${(x / STAGE_W) * 100}%`,
                    top: `${(y / H) * 100}%`,
                    borderColor: STATE_COLOR[s],
                    boxShadow: isActive
                      ? `0 0 0 2px ${cardGlow(s)}, 0 6px 18px rgba(0,0,0,.5)`
                      : undefined,
                  }}
                >
                  <span className="card-id">P{p}</span>
                  <span className="card-st" style={{ color: STATE_COLOR[s] }}>
                    {label(s)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* narration */}
          <div className="narration">
            <span className="frame-no">
              {idx}/{frames.length - 1}
            </span>
            <span className="note">{frame.note}</span>
          </div>

          {/* transport */}
          <div className="transport">
            <button onClick={() => step(-1)} disabled={idx === 0}>
              <SkipBack size={16} />
            </button>
            <button className="play" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {playing ? "Pause" : idx >= frames.length - 1 ? "Replay" : "Play"}
            </button>
            <button onClick={() => step(1)} disabled={idx >= frames.length - 1}>
              <SkipForward size={16} />
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setIdx(0);
              }}
            >
              <RotateCcw size={16} />
            </button>
            <input
              className="scrub"
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              onChange={(e) => {
                setPlaying(false);
                setIdx(Number(e.target.value));
              }}
            />
          </div>
        </div>

        {/* ---------- CODE ---------- */}
        <div className="codes">
          <CodePanel
            title={
              type === "binary"
                ? "binary_semaphore.py"
                : "counting_semaphore.py"
            }
            lines={semLines}
            activeLine={semActive}
          />
          <CodePanel
            title="process.py"
            lines={PROC_CODE}
            activeLine={procActive}
          />
        </div>
      </div>
    </div>
  );
}

function Zone({ x, y, w, h, label, color }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="14"
        className="zone"
        stroke={color}
      />
      <text x={x + 12} y={y - 8} className="zone-tag" fill={color}>
        {label}
      </text>
    </g>
  );
}

const label = (s) =>
  ({
    ready: "ready",
    calling_wait: "wait()",
    in_cs: "using",
    blocked: "blocked",
    exiting: "signal()",
    done: "done",
  })[s] || s;

const cardGlow = (s) =>
  ({
    ready: "#5b6b7d",
    calling_wait: "#f5a623",
    in_cs: "#3dd7c2",
    blocked: "#ff6b6b",
    exiting: "#9aa7b4",
    done: "#9aa7b4",
  })[s];

/* ============================================================
   STYLES
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.root{
  --bg:#0a0e14; --panel:#10161f; --panel2:#0d131b; --line:#1e2733;
  --ink:#e6edf3; --mut:#7d8b9a;
  --accent:#f5a623; --cs:#3dd7c2; --blk:#ff6b6b; --ready:#6b7c8f; --done:#8b98a6;
  background:
    radial-gradient(1200px 500px at 80% -10%, rgba(61,215,194,.07), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(245,166,35,.06), transparent 60%),
    var(--bg);
  color:var(--ink);
  font-family:'IBM Plex Mono', ui-monospace, monospace;
  padding:22px; border-radius:16px;
  font-size:13px; line-height:1.5;
}
.root *{box-sizing:border-box;}

header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;}
h1{font-family:'Fraunces',serif;font-weight:600;font-size:34px;margin:0;letter-spacing:-.5px;}
h1 .dot{color:var(--accent);}
.sub{color:var(--mut);margin:2px 0 0;font-size:12.5px;}

.seg{display:flex;background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:4px;}
.seg button{font-family:inherit;background:none;border:none;color:var(--mut);padding:7px 16px;border-radius:8px;cursor:pointer;font-size:13px;transition:.2s;}
.seg button.on{background:var(--accent);color:#1a1205;font-weight:600;}

.controls{display:flex;align-items:flex-end;gap:26px;margin-top:18px;padding:14px 18px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;flex-wrap:wrap;}
.grow{flex:1;}
.lbl{font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--mut);margin-bottom:6px;}
.stepper{display:flex;align-items:center;gap:2px;background:var(--bg);border:1px solid var(--line);border-radius:9px;overflow:hidden;}
.stepper span{min-width:34px;text-align:center;font-size:16px;font-weight:600;}
.stepper button{background:none;border:none;color:var(--ink);padding:7px 9px;cursor:pointer;display:grid;place-items:center;}
.stepper button:disabled{color:#3a4757;cursor:not-allowed;}
.stepper button:hover:not(:disabled){background:var(--line);}
.speed{min-width:150px;}
.speed input{width:100%;accent-color:var(--accent);}

.readout{display:flex;gap:12px;margin-top:14px;flex-wrap:wrap;}
.metric{flex:1;min-width:110px;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:11px 14px;display:flex;flex-direction:column;gap:3px;}
.m-lbl{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--mut);}
.m-val{font-size:26px;font-weight:600;font-family:'Fraunces',serif;}
.m-val i{font-style:normal;font-size:15px;color:var(--mut);}
.m-val.neg{color:var(--blk);}
.m-val.cs{color:var(--cs);}
.m-val.blk{color:var(--blk);}

.grid{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;margin-top:16px;}
@media(max-width:880px){.grid{grid-template-columns:1fr;}}

.stage-wrap{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;}
.stage{position:relative;width:100%;}
.stage-svg{position:absolute;inset:0;width:100%;height:100%;}
.zone{fill:rgba(255,255,255,.012);stroke-width:1.2;stroke-dasharray:4 5;opacity:.55;}
.zone-tag{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1px;font-weight:600;opacity:.85;}
.slot{fill:rgba(61,215,194,.05);stroke:rgba(61,215,194,.32);stroke-width:1;stroke-dasharray:3 4;}
.baseline{stroke:var(--line);stroke-width:1;}

.card{position:absolute;border:1.6px solid;border-radius:10px;background:linear-gradient(180deg,#161e29,#0f151d);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  transition:left .55s cubic-bezier(.65,0,.25,1), top .55s cubic-bezier(.65,0,.25,1), box-shadow .25s, border-color .3s;
  min-width:48px;}
.card.active{z-index:5;}
.card-id{font-weight:600;font-size:13px;line-height:1;}
.card-st{font-size:8.5px;letter-spacing:.3px;margin-top:2px;line-height:1;}

.narration{display:flex;gap:12px;align-items:center;margin-top:10px;padding:10px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;min-height:42px;}
.frame-no{font-size:11px;color:var(--mut);background:var(--bg);padding:3px 8px;border-radius:6px;border:1px solid var(--line);white-space:nowrap;}
.note{font-size:12.5px;color:var(--ink);}

.transport{display:flex;align-items:center;gap:8px;margin-top:10px;}
.transport button{font-family:inherit;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;transition:.18s;}
.transport button:hover:not(:disabled){border-color:var(--accent);}
.transport button:disabled{opacity:.35;cursor:not-allowed;}
.transport .play{background:var(--accent);color:#1a1205;border-color:var(--accent);font-weight:600;padding:8px 16px;}
.scrub{flex:1;accent-color:var(--accent);}

.codes{display:flex;flex-direction:column;gap:14px;}
.code{background:var(--panel2);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.code-title{font-size:11px;color:var(--mut);padding:9px 14px;border-bottom:1px solid var(--line);letter-spacing:.5px;background:rgba(255,255,255,.015);}
.code pre{margin:0;padding:8px 0;overflow-x:auto;}
.code-line{display:flex;gap:12px;padding:1px 14px;white-space:pre;font-size:12px;border-left:2px solid transparent;}
.code-line .ln{color:#3f4d5d;user-select:none;}
.code-line .src{color:#c4d0dc;}
.code-line.hot{background:linear-gradient(90deg,rgba(245,166,35,.18),rgba(245,166,35,.02));border-left-color:var(--accent);}
.code-line.hot .src{color:#fff;}
.code-line.hot .ln{color:var(--accent);}
`;
