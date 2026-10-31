import React, { useMemo, useState } from "react";
import { downloadBlob } from "../core/bytes";
import { EXAMPLES } from "../tutorials/examples";
import { GoTarget, Tutorial, toMarkdown, TUTORIALS } from "../tutorials/content";
import { useApp } from "../store";
import { getLang, Rich } from "../i18n";
import { Panel } from "../ui/common";
import { tr, Tx } from "../i18n";


const DONE_KEY = "nghs.tutorialDone";

export function TutorialsView() {
  const app = useApp();
  const { rs, profile, version, toast, setTab, gotoCode, gotoHex, gotoTile } = app;
  const [sel, setSel] = useState(TUTORIALS[0].id);
  const [zoom, setZoom] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const t = TUTORIALS.find((x) => x.id === sel)!;
  const isKof97 = profile.id === "kof97" && !!rs && !rs.setName.includes("synthetic");

  const checks = useMemo(() => {
    const m: Record<string, boolean> = {};
    if (!rs) return m;
    for (const tu of TUTORIALS)
      tu.steps.forEach((s, i) => {
        if (!s.check) return;
        try {
          m[`${tu.id}:${i}`] = s.check(rs);
        } catch {
          m[`${tu.id}:${i}`] = false;
        }
      });
    return m;
  }, [rs, version]);

  const isDone = (id: string, i: number) => !!checks[`${id}:${i}`] || !!done[`${id}:${i}`];
  const toggle = (id: string, i: number) => {
    const n = { ...done, [`${id}:${i}`]: !done[`${id}:${i}`] };
    setDone(n);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  const progress = (tu: Tutorial) => tu.steps.filter((_, i) => isDone(tu.id, i)).length;

  const go = (g: GoTarget) => {
    if ("tab" in g) setTab(g.tab);
    else if ("code" in g) gotoCode(g.code, 0);
    else if ("hex" in g) gotoHex(g.hex, g.bank ?? 0);
    else if ("tile" in g) gotoTile(g.tile);
  };

  const apply = () => {
    if (!rs || !t.example) return;
    try {
      const msg = EXAMPLES[t.example](rs);
      toast(tr("Applied: {msg}", { msg }), "ok");
    } catch (e: any) {
      toast(tr("Could not apply: {msg}", { msg: e.message }), "error");
    }
  };

  const sections = [...new Set(TUTORIALS.map((x) => x.section))];
  const linkTo = (target: string) => target.startsWith("tab:") && setTab(target.slice(4) as Parameters<typeof setTab>[0]);

  return (
    <div className="split wide" style={{ gridTemplateColumns: "300px minmax(0,1fr)" }}>
      <div>
        <Panel
          title={tr("Tutorials")}
          actions={
            <button className="btn sm" onClick={() => downloadBlob(toMarkdown(TUTORIALS), `HackROM-Studio-tutorials-${getLang()}.md`, "text/markdown")} title={tr("Download every tutorial as one Markdown file")}>{tr("⇩ .md")}</button>
          }
        >
          {sections.map((s) => (
            <div key={s} style={{ marginBottom: 10 }}>
              <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>
                {tr(s)}
              </div>
              {TUTORIALS.filter((x) => x.section === s).map((x) => {
                const p = progress(x);
                return (
                  <div key={x.id} className={"tut-item" + (x.id === sel ? " on" : "")} onClick={() => setSel(x.id)}>
                    <span>{tr(x.title)}</span>
                    <span className={"small " + (p === x.steps.length ? "ok" : "muted")}>
                      {p}/{x.steps.length}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="muted small">{tr("Reference docs (formats, tables, how things work) are in the Guides tab.")}</p>
        </Panel>
      </div>
      <div>
        <Panel title={tr(t.section)}>
          <h2 style={{ marginBottom: 4 }}>{tr(t.title)}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {tr(t.summary)} · <span className="small">{tr(t.time)}</span>
          </p>
          {!rs && (
            <div className="notice info"><Tx s="Load your `kof97.zip` (or the synthetic demo) on the ROM set page to follow along." />{" "}
              <a onClick={() => setTab("home")}>{tr("Open ROM set")}</a>
            </div>
          )}
          <ol className="tut-steps">
            {t.steps.map((s, i) => {
              const d = isDone(t.id, i);
              const auto = !!checks[`${t.id}:${i}`];
              return (
                <li key={i} className={d ? "done" : ""}>
                  <button className={"tick" + (d ? " on" : "")} onClick={() => toggle(t.id, i)} title={auto ? "Detected in the loaded ROM" : "Mark as done"}>
                    {d ? "✓" : i + 1}
                  </button>
                  <div>
                    <Rich text={tr(s.text)} onLink={linkTo} />
                    {auto && <span className="ok small">{" "}{tr("· detected in your ROM")}</span>}
                    {s.go && (
                      <div>
                        <button className="btn sm" style={{ marginTop: 4 }} onClick={() => go(s.go!)} disabled={!rs && !("tab" in s.go)}>
                          {s.goLabel ? tr(s.goLabel) : tr("Go there →")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {t.example && (
            <div className="notice info row" style={{ justifyContent: "space-between" }}>
              <span>{tr("Shortcut: make exactly this edit on your KOF97 set (undo with Ctrl+Z).")}</span>
              <button className="btn primary" disabled={!isKof97} title={isKof97 ? "" : tr("Load the real kof97 set to use this")} onClick={apply}>{tr("Apply this example for me")}</button>
            </div>
          )}
          {t.result && (
            <div className="notice" style={{ background: "#0f2016", borderColor: "#2e6b46", color: "#bff0cf" }}>
              <b>{tr("Result:")}</b> {tr(t.result)}
            </div>
          )}
          {t.shots && (
            <div className="tut-shots">
              {t.shots.map((s) => (
                <figure key={s.src} onClick={() => setZoom(s.src)}>
                  <img src={s.src} alt={tr(s.caption)} />
                  <figcaption>{tr(s.caption)}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {t.notes?.map((n) => (
            <p key={n} className="muted small">
              <Rich text={tr(n)} />
            </p>
          ))}
          <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <button className="btn" disabled={TUTORIALS[0].id === t.id} onClick={() => setSel(TUTORIALS[TUTORIALS.findIndex((x) => x.id === t.id) - 1].id)}>{tr("← Previous")}</button>
            <button className="btn" disabled={TUTORIALS[TUTORIALS.length - 1].id === t.id} onClick={() => setSel(TUTORIALS[TUTORIALS.findIndex((x) => x.id === t.id) + 1].id)}>{tr("Next →")}</button>
          </div>
        </Panel>
      </div>
      {zoom && (
        <div className="modal-bg" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" style={{ imageRendering: "pixelated", width: "min(90vw, 1216px)", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
