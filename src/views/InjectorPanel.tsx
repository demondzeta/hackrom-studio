// Live tab: write small Lua programs that drive P1/P2 in the running game (tools/live/injector.lua).
import React, { useEffect, useState } from "react";
import { hex } from "../core/bytes";
import { MoveEntry, buttonsText } from "../games/kofEngine";
import { tr, Tx } from "../i18n";
import { useLive } from "../live/live";
import { useApp } from "../store";
import { Panel } from "../ui/common";

const KEY = "nghs.injector";

interface Example {
  title: string;
  /** only shown for these profile ids (all games when missing) */
  games?: string[];
  code: string;
}

export const INJECTOR_EXAMPLES: Example[] = [
  {
    title: "P2 performs a motion",
    code: `-- numpad notation, relative to where P2 is facing: 2 = down, 3 = down-forward, 6 = forward
motion(P2, "236A")
waitNeutral(P2)
log("P2 is back in neutral")`,
  },
  {
    title: "P2 repeats a move forever",
    code: `while true do
  motion(P2, "236A")
  waitNeutral(P2)
  wait(30)
end`,
  },
  {
    title: "Anti-air bot: P2 answers every jump",
    code: `while true do
  if info(P1).air then
    motion(P2, "623C")
    waitNeutral(P2)
  end
  wait()
end`,
  },
  {
    title: "Training dummy: P2 blocks and never dies",
    code: `while true do
  setHp(P2, 0x66)
  hold(P2, "4")      -- hold back = block
  wait()
end`,
  },
  {
    title: "Super motion (slower steps)",
    code: `setPower(P1, 3)
-- 4 frames per step: faster and the game reads the two forwards as a dash first
motion(P1, "236236A", 4)
waitNeutral(P1, 600)`,
  },
  {
    title: "Cancel a move: force the neutral state",
    games: ["kof97"],
    code: `move(P1, 0x2FCF0)   -- Oniyaki
wait(8)
w32(P1, 0xF43E)     -- write the neutral entry into +0: Kyo stands on the next frame`,
  },
  {
    title: "Puppet: play any animation without its move",
    code: `-- writing +$72 restarts the animation (the stepper compares it with +$78);
-- the boxes in the ACT come with it, damage/jumps/projectiles do not (they live in the routine)
w16(P1 + 0x72, 0x51)
wait(60)
press(P1, "4", 2)    -- any input returns the fighter to its normal states`,
  },
  {
    title: "Watch the state machine (log every state change)",
    code: `local last
for i = 1, 600 do
  local s = info(P1)
  local k = string.format("%06X/%03X", s.state, s.act)
  if k ~= last then
    log(string.format("P1 state $%06X  ACT %03X  routine $%06X", s.state, s.act, s.routine))
    last = k
  end
  wait()
end`,
  },
  {
    title: "KOF97: Kyo's Oniyaki started by its routine",
    games: ["kof97"],
    code: `-- P1 must be Kyo. Writing the routine into +$198 and +0 starts the move on the next frame.
move(P1, 0x2FCF0)
waitNeutral(P1)
log("Oniyaki finished")`,
  },
  {
    title: "KOF97: Kyo's Mu Shiki with 3 stocks",
    games: ["kof97"],
    code: `setPower(P1, 3)
move(P1, 0x315F8)   -- supers spend power like a normal input would
waitNeutral(P1, 600)`,
  },
  {
    title: "KOF97 demo: Iori fireball, Kyo Oniyaki, Iori Oniyaki, Kyo super",
    games: ["kof97"],
    code: `-- checked in FBNeo from the Kyo (P1) vs Iori (P2) savestate
motion(P2, "236A")          -- Iori: 108 Shiki Yami Barai
waitNeutral(P2)
move(P1, 0x2FCF0)           -- Kyo: Oniyaki by routine
waitNeutral(P1)
press(P2, "6", 20)          -- Iori walks forward
motion(P2, "623C")          -- Iori: 100 Shiki Oniyaki
waitNeutral(P2)
setPower(P1, 3)
move(P1, 0x315F8)           -- Kyo: Mu Shiki (cuts into whatever he was doing)
waitNeutral(P1, 600)
log("P2 hp", info(P2).hp)`,
  },
];

function escapeForLink(code: string) {
  return code.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
}

export function InjectorPanel({ p1Moves, p2Moves }: { p1Moves: MoveEntry[]; p2Moves: MoveEntry[] }) {
  const { profile } = useApp();
  const { connected, send, state } = useLive();
  const examples = INJECTOR_EXAMPLES.filter((e) => !e.games || e.games.includes(profile.id));
  const [code, setCode] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? examples[0].code;
    } catch {
      return examples[0].code;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* ignore */
    }
  }, [code]);

  const insert = (line: string) => setCode((c) => (c.endsWith("\n") || !c ? c : c + "\n") + line + "\n");
  const moveOptions = (who: "P1" | "P2", moves: MoveEntry[]) =>
    moves.map((m, i) => (
      <option key={who + i} value={`move(${who}, 0x${hex(m.routine, 5)})  -- ${m.context}${m.slot !== null ? " slot " + m.slot : ""} ${buttonsText(m.buttons)} ACT ${m.acts.slice(0, 3).map((a) => hex(a, 2)).join(",")}\nwaitNeutral(${who})`}>
        {who} · ${hex(m.routine, 6)} · {tr(m.context)} {m.slot !== null ? tr("slot") + " " + m.slot : ""} {buttonsText(m.buttons)}
      </option>
    ));

  return (
    <Panel title={tr("Lua injector: make P1 / P2 do anything")}>
      <div className="col">
        <p className="muted small" style={{ margin: 0 }}>
          <Tx s="Programs run inside FBNeo one step per frame (`tools/live/injector.lua`). `motion(P2, '236A')` types a motion through the game's own input reading; `move(P1, 0x2FCF0)` starts a complete move routine directly; `wait(n)`, `waitNeutral(P)` and `waitUntil(fn)` pause until something happens. Full reference: Guides & docs → Live tab & move state machine." />
        </p>
        <div className="row">
          <select className="inp" value="" onChange={(e) => e.target.value && setCode(examples[+e.target.value].code)}>
            <option value="">{tr("Examples…")}</option>
            {examples.map((e, i) => (
              <option key={i} value={i}>{tr(e.title)}</option>
            ))}
          </select>
          <select className="inp" value="" onChange={(e) => e.target.value && insert(e.target.value)} disabled={!p1Moves.length && !p2Moves.length}>
            <option value="">{tr("Insert a move from the move list…")}</option>
            {moveOptions("P1", p1Moves)}
            {moveOptions("P2", p2Moves)}
          </select>
        </div>
        <textarea className="inp mono" style={{ minHeight: 220, width: "100%" }} spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="row">
          <button className="btn primary" disabled={!connected || state?.lua === -1} onClick={() => send([`lua ${escapeForLink(code)}`])}>{tr("▶ Run in the emulator")}</button>
          <button className="btn" disabled={!connected} onClick={() => send(["luastop"])}>{tr("■ Stop all programs")}</button>
          <span className="muted small">
            {state?.lua === -1 ? tr("injector.lua was not found next to hackrom_live.lua") : tr("{n} program(s) running", { n: state?.lua ?? 0 })}
          </span>
        </div>
        <pre className="mono small" style={{ maxHeight: 180, overflow: "auto", margin: 0 }}>{(state?.luaOut ?? []).join("\n") || tr("(injector log)")}</pre>
      </div>
    </Panel>
  );
}
