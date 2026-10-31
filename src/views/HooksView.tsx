import React, { useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { applyHook, findFreeSpace, findMainLoops, planHook, readHeader } from "../core/analysis";
import { useApp } from "../store";
import { Addr, HexInput, NeedRom, Panel } from "../ui/common";
import { programCode } from "./CodeView";
import { LiveButton, writeCmds } from "../live/live";
import { tr, Tx } from "../i18n";


function readHeaderSafe(rs: ReturnType<typeof useApp>["rs"]): number {
  return rs ? readHeader(rs).entries[0].target ?? 0 : 0;
}

interface Template {
  name: string;
  desc: string;
  code: string;
  kofOnly?: boolean;
}

const TEMPLATES: Template[] = [
  {
    name: "Empty",
    desc: "Your own code. Registers are saved/restored around it when the box is ticked.",
    code: "; your code here — runs every time the hooked instruction runs\n    nop\n",
  },
  {
    name: "Freeze round timer",
    desc: "Writes 60 to the timer every frame (KOF97/98 RAM $10A83A).",
    kofOnly: true,
    code: "    move.b   #$60,$10A83A\n",
  },
  {
    name: "P1 infinite health",
    desc: "Keeps P1 health byte full ($66) every frame.",
    kofOnly: true,
    code: "    move.b   #$66,$108239\n",
  },
  {
    name: "P1 max power",
    desc: "Keeps 3 power stocks.",
    kofOnly: true,
    code: "    move.b   #$03,$1082E3\n",
  },
  {
    name: "Debug markers",
    desc: "Sets KOF debug dip $100000 bit 1: draws object position markers (checked in FBNeo). Use $80 instead for the hidden debug menus.",
    kofOnly: true,
    code: "    ori.b    #$02,$100000\n",
  },
  {
    name: "Button combo → move (P1)",
    desc: "When P1 presses A+B+C on the same frame, P1's object continues with your routine. Point ROUTINE at a move routine (see Characters & moves → Move routines). Experimental: test in MAME.",
    kofOnly: true,
    code: `ROUTINE  equ $2FCF0            ; move routine to start (KOF97: Kyo Oniyaki; $2FEDA = Kyo Red Kick)
    move.b   $10FD97,d0           ; BIOS_P1CHANGE: buttons pressed this frame
    andi.b   #$70,d0              ; A=$10 B=$20 C=$40 D=$80
    cmpi.b   #$70,d0
    bne.s    .skip
    tst.w    $108172              ; only while an ACT is set (in a fight)
    beq.s    .skip
    move.l   #ROUTINE,$108298     ; P1 move routine (+$198)
    move.l   #ROUTINE,$108100     ; P1 next routine (+0) -> runs next frame
.skip:
`,
  },
  {
    name: "Armor while an ACT plays (P1)",
    desc: "P1 takes damage without hit reactions while playing ACT code ACT (checked in FBNeo with Kyo 88 Shiki, $B5). Sets P2's +$E6 bit 0 during the move.",
    kofOnly: true,
    code: `ACT      equ $B5                  ; P1 ACT code of the move (see Live tab or Move list)
    cmpi.w   #ACT,$108172          ; P1 ACT code
    bne.s    .off
    ori.b    #$01,$1083E6          ; P2 +$E6 bit 0: P2's hits cause no hitstun
    bra.s    .done
.off:
    andi.b   #$FE,$1083E6
.done:
`,
  },
  {
    name: "Call my subroutine",
    desc: "Calls a routine you assembled elsewhere (e.g. with the routine editor).",
    code: "    jsr      $0F0000              ; change to your routine address\n",
  },
];

export function HooksView() {
  const { rs, version, profile, toast, gotoCode } = useApp();
  const [site, setSite] = useState<number>(profile.mainLoop?.loopPoints[0] ?? readHeaderSafe(rs));
  const [hookAddr, setHookAddr] = useState<number | null>(null);
  const [save, setSave] = useState(true);
  const [tpl, setTpl] = useState(0);
  const [code, setCode] = useState(TEMPLATES[0].code);
  const [loops, setLoops] = useState<ReturnType<typeof findMainLoops>["loops"] | null>(null);

  const free = useMemo(() => {
    if (!rs?.p1File) return [];
    return findFreeSpace(rs.p1File.data, 128, rs.p1FixedOffset, rs.p1FixedOffset + 0x100000).map((f) => ({ addr: f.offset - rs.p1FixedOffset, length: f.length }));
  }, [rs, version]);

  if (!rs) return <NeedRom />;
  const h = readHeader(rs);
  const hAddr = hookAddr ?? free[0]?.addr ?? 0xf0000;
  const traced = programCode(rs, profile.mainLoop ? [profile.mainLoop.entry] : []);
  const plan = planHook(rs, site, hAddr, code, save, {}, traced);

  return (
    <div className="col">
      <div className="grid2">
        <Panel title={tr("How the game runs")}>
          <p className="muted small"><Tx s="The BIOS calls **USER** (header $122). The game then runs its own loop: wait for VBlank, read inputs, run every object (players, effects), build the sprite list. Code placed in that loop runs once per frame." /></p>
          <div className="kv small">
            {h.entries.map((e) => (
              <React.Fragment key={e.name}>
                <span>{e.name}</span>
                <span>{e.target !== null ? <Addr a={e.target} /> : "—"}</span>
              </React.Fragment>
            ))}
            {h.vectors
              .filter((v) => v.vector >= 0x64)
              .map((v) => (
                <React.Fragment key={v.name}>
                  <span>{v.name}</span>
                  <span>
                    <Addr a={v.target} />
                  </span>
                </React.Fragment>
              ))}
          </div>
          {profile.mainLoop && (
            <div className="notice info" style={{ marginTop: 10 }}>{tr("Known main loop for {name}:", { name: profile.name })} {tr("entry")} <Addr a={profile.mainLoop.entry} />, {tr("loop points")}{" "}
              {profile.mainLoop.loopPoints.map((p) => (
                <span key={p}>
                  <Addr a={p} />{" "}
                </span>
              ))}
              <div className="small">{tr(profile.mainLoop.note)}</div>
            </div>
          )}
        </Panel>
        <Panel
          title={tr("Main loop detection")}
          actions={
            <button className="btn sm" onClick={() => setLoops(findMainLoops(rs, profile.mainLoop ? [profile.mainLoop.entry] : []).loops)}>{tr("Analyse")}</button>
          }
          scroll
        >
          {!loops ? (
            <p className="muted">{tr("Traces code from the header entries and the VBlank handler and ranks loops that call many subroutines and wait on a RAM flag.")}</p>
          ) : loops.length === 0 ? (
            <div className="muted">
              <p><Tx s="No loop candidates found. Some games have no loop of their own: the BIOS calls USER every frame (it ends with `jmp $C00444`, SYSTEM_RETURN) and work happens there or in the VBlank handler." /></p>
              <div className="row">
                {h.entries[0].target !== null && (
                  <button className="btn sm" onClick={() => setSite(h.entries[0].target!)}>{tr("hook USER $")}{hex(h.entries[0].target, 6)}
                  </button>
                )}
                {(() => {
                  const v = h.vectors.find((x) => x.vector === 0x64)?.target;
                  return v !== undefined && v < 0x100000 ? (
                    <button className="btn sm" onClick={() => setSite(v)}>{tr("hook VBlank $")}{hex(v, 6)}
                    </button>
                  ) : null;
                })()}
              </div>
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>{tr("loop")}</th>
                  <th>{tr("score")}</th>
                  <th>{tr("why")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loops.map((l) => (
                  <tr key={l.start + "_" + l.end}>
                    <td>
                      <Addr a={l.start} />…{hex(l.end, 6)}
                    </td>
                    <td>{l.score}</td>
                    <td className="small muted">{l.reasons.join(", ")}</td>
                    <td>
                      <button className="btn sm" onClick={() => setSite(l.start)}>{tr("hook here")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title={tr("Hook builder (detour)")}>
        <div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 420px" }}>
          <div className="col">
            <div className="row">
              <label className="f">{tr("hook site")}{" "}<HexInput value={site} onChange={(v) => setSite(v & 0xfffffe)} width={70} />
              </label>
              <button className="btn sm" onClick={() => gotoCode(site, 0)}>{tr("view")}</button>
              <label className="f">{tr("hook code at")}{" "}<HexInput value={hAddr} onChange={(v) => setHookAddr(v & 0xfffffe)} width={70} />
              </label>
              <select value="" onChange={(e) => e.target.value && setHookAddr(+e.target.value)}>
                <option value="">{tr("free space in P1…")}</option>
                {free.slice(0, 20).map((f) => (
                  <option key={f.addr} value={f.addr}>
                    ${hex(f.addr, 6)} ({f.length}{" "}{tr("bytes)")}</option>
                ))}
              </select>
              <label className="f">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{" "}{tr("save registers")}</label>
            </div>
            <div className="row">
              <span className="muted">{tr("template")}</span>
              <select
                value={tpl}
                onChange={(e) => {
                  const i = +e.target.value;
                  setTpl(i);
                  setCode(TEMPLATES[i].code);
                }}
              >
                {TEMPLATES.map((t, i) => (
                  <option key={t.name} value={i} disabled={t.kofOnly && !profile.kof}>
                    {tr(t.name)}
                    {t.kofOnly ? " (KOF)" : ""}
                  </option>
                ))}
              </select>
              <span className="muted small">{tr(TEMPLATES[tpl].desc)}</span>
            </div>
            <textarea rows={14} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
            {plan.errors.map((e) => (
              <div key={e} className="notice err">
                {e}
              </div>
            ))}
            {plan.warnings.map((w) => (
              <div key={w} className="notice">
                {w}
              </div>
            ))}
            <div className="row">
              <button
                className="btn primary"
                disabled={!plan.ok}
                onClick={() => {
                  try {
                    applyHook(rs, plan);
                    toast(tr("Hook installed at ${site} → ${addr} ({n} bytes)", { site: hex(site, 6), addr: hex(hAddr, 6), n: plan.hookCode.length }), "ok");
                  } catch (e: any) {
                    toast(e.message, "error");
                  }
                }}
              >{tr("Install hook")}</button>
              <LiveButton small={false} label={tr("Install live (temporary)")} cmds={() => (plan.ok ? [...writeCmds(rs, plan.hookAddr, plan.hookCode), ...writeCmds(rs, plan.site, plan.sitePatch)] : null)} title={tr("Write the hook into the running game only; resetting the game removes it")} />
              <span className="muted small">{tr("Undo removes it again. Test in the emulator before building on it.")}</span>
            </div>
          </div>
          <div>
            <h4 style={{ marginTop: 0 }}>{tr("What will be written")}</h4>
            <pre className="listing">{plan.listing}</pre>
            <p className="muted small"><Tx s="The first {n} bytes at the site become `jmp hook`. The hook runs your code, then the instructions it replaced, then jumps back — so the game behaves exactly as before plus your code." vars={{ n: plan.displacedBytes }} /></p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
