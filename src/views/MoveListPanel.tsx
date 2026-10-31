import React, { useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { analyzeMoves, buttonsText, commandSlots, commandTableFor, handlerFor, inputToArrows } from "../games/kofEngine";
import { LiveButton } from "../live/live";
import { useApp } from "../store";
import { Addr, Empty, Panel } from "../ui/common";
import { tr, Tx } from "../i18n";

/** Complete moves of a character: input -> handler -> move routine -> the ACTs it plays. */
export function MoveListPanel() {
  const { rs, profile, version } = useApp();
  const k = profile.kof!;
  const [ch, setCh] = useState(0);
  const moves = useMemo(() => (rs ? analyzeMoves(rs, k, ch) : []), [rs, k, ch, version]);
  const slots = useMemo(() => {
    if (!rs) return [];
    const t = commandTableFor(rs, k, ch, 1);
    return t ? commandSlots(rs, t) : [];
  }, [rs, k, ch, version]);
  if (!rs) return null;
  if (k.handlerTable === undefined) return <Empty>{tr("This profile does not know where the command handlers are.")}</Empty>;
  const handler = handlerFor(rs, k, ch);

  return (
    <div className="split wide" style={{ gridTemplateColumns: "190px minmax(0,1fr)" }}>
      <Panel title={tr("Character")} scroll>
        <table className="t">
          <tbody>
            {profile.characters.slice(0, 32).map((n, i) => (
              <tr key={i} className={"click" + (i === ch ? " sel" : "")} onClick={() => setCh(i)}>
                <td className="mono muted">{hex(i, 2)}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div>
        <Panel title={tr("{name} — complete moves", { name: profile.characters[ch] })}>
          <p className="muted small" style={{ marginTop: 0 }}><Tx s="How a move is chosen: the command parser marks which motions of the character's check table were entered; the command handler (`${h}`) tests those bits and the buttons, then stores a **move routine** in the player object (+$198). The routine is the complete move: it sets damage, speed and sounds and plays its ACTs one after another (supers have many). Handler table: ${t} + char × 2." vars={{ h: handler !== null ? hex(handler, 6) : "?", t: hex(k.handlerTable, 6) }} />
          </p>
          <table className="t">
            <thead>
              <tr>
                <th>{tr("section")}</th>
                <th>{tr("input")}</th>
                <th>{tr("type")}</th>
                <th>{tr("routine")}</th>
                <th>{tr("ACTs played")}</th>
                <th>{tr("damage")}</th>
                <th>{tr("live")}</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.site}>
                  <td className="small">{tr(m.context)}</td>
                  <td>
                    <span className="motion" style={{ fontSize: 15 }}>
                      {m.slot !== null && slots[m.slot] ? slots[m.slot].def.steps.map((s) => inputToArrows(s.input)).join(" ") : ""}
                    </span>
                    <span className="small"> {buttonsText(m.buttons)}</span>
                    {m.slot !== null ? <div className="muted small">{tr("slot")}{" "}{m.slot}</div> : m.check !== undefined ? <div className="muted small">{tr("check")}{" "}<Addr a={m.check} /></div> : null}
                  </td>
                  <td className="small">{tr(m.kind)}</td>
                  <td>
                    <Addr a={m.routine} />
                    <div className="muted small">{tr("set at")}{" "}<Addr a={m.site} />
                    </div>
                  </td>
                  <td className="mono small">{m.acts.map((a) => hex(a, 2)).join(" ")}</td>
                  <td className="mono small">{m.damage.map((a) => hex(a, 2)).join(" ")}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <LiveButton label="P1" cmds={() => [`trigger 108100 ${hex(m.routine, 6)}`]} title={tr("Start this move on P1 now (P1 must be this character)")} />
                      <LiveButton label="P2" cmds={() => [`trigger 108300 ${hex(m.routine, 6)}`]} title={tr("Start this move on P2 now (P2 must be this character)")} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{tr("ACT numbers are the P1 codes the routine writes ($D2/$D4/$D6… and $72); from $80 up they equal the P2 ACT index used in the Animations tab. Damage values are indexes into the game's damage table. Routines can be cloned and edited in Move routines.")}</p>
        </Panel>
      </div>
    </div>
  );
}
