import React from "react";
import { Tx, tr } from "../../i18n";

/** Documentation content as data so every sentence can be translated as a whole. Text uses `code`, **bold**, *italic*, [label](tab:name). */
export type Block =
  | { h2: string }
  | { h4: string }
  | { p: string; muted?: boolean }
  | { ul: string[] }
  | { ol: string[] }
  | { table: { head?: string[]; rows: string[][]; mono?: number[] } }
  | { fig: { src: string; caption: string } }
  | { notice: string; info?: boolean }
  | { steps: string[] }
  | { chain: [string, string][]; arrow?: string }
  | { bytes: [string, string, string?][] }
  | { legend: [string, string][] }
  | { grid: Block[][] }
  /** program listing (Lua / 68k): shown as is, never translated */
  | { code: string };

export function DocBlocks({ blocks, onLink }: { blocks: Block[]; onLink: (target: string) => void }) {
  const T = (s: string) => <Tx s={s} onLink={onLink} />;
  return (
    <>
      {blocks.map((b, i) => {
        if ("h2" in b) return <h2 key={i}>{tr(b.h2)}</h2>;
        if ("code" in b) return <pre key={i} className="doccode mono">{b.code}</pre>;
        if ("h4" in b) return <h4 key={i}>{tr(b.h4)}</h4>;
        if ("p" in b) return <p key={i} className={b.muted ? "muted small" : undefined}>{T(b.p)}</p>;
        if ("ul" in b) return <ul key={i}>{b.ul.map((x, k) => <li key={k}>{T(x)}</li>)}</ul>;
        if ("ol" in b) return <ol key={i}>{b.ol.map((x, k) => <li key={k}>{T(x)}</li>)}</ol>;
        if ("steps" in b) return <React.Fragment key={i}>{b.steps.map((x, k) => <div key={k} className="step">{T(x)}</div>)}</React.Fragment>;
        if ("notice" in b) return <div key={i} className={"notice" + (b.info ? " info" : "")}>{T(b.notice)}</div>;
        if ("fig" in b)
          return (
            <figure key={i} className="docfig">
              <img src={b.fig.src} alt={tr(b.fig.caption)} />
              <figcaption>{T(b.fig.caption)}</figcaption>
            </figure>
          );
        if ("table" in b)
          return (
            <table key={i} className="t" style={{ marginBottom: 10 }}>
              {b.table.head && (
                <thead>
                  <tr>{b.table.head.map((h, k) => <th key={k}>{tr(h)}</th>)}</tr>
                </thead>
              )}
              <tbody>
                {b.table.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j} className={b.table.mono?.includes(j) ? "mono" : undefined}>
                        {b.table.mono?.includes(j) ? c : T(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        if ("chain" in b)
          return (
            <div key={i} className="chain">
              {b.chain.map(([t, d], k) => (
                <React.Fragment key={k}>
                  <div className="chain-step">
                    <b>{tr(t)}</b>
                    <span>{tr(d)}</span>
                  </div>
                  {k < b.chain.length - 1 && <div className="chain-arrow">{b.arrow ?? "→"}</div>}
                </React.Fragment>
              ))}
            </div>
          );
        if ("bytes" in b)
          return (
            <div key={i} className="bytes">
              {b.bytes.map(([v, label, color], k) => (
                <div key={k} className="byte" style={color ? { borderColor: color } : undefined}>
                  <b>{v}</b>
                  <span>{tr(label)}</span>
                </div>
              ))}
            </div>
          );
        if ("legend" in b)
          return (
            <div key={i} className="legend" style={{ gap: 18, margin: "8px 0" }}>
              {b.legend.map(([c, l], k) => (
                <span key={k}>
                  <i style={{ background: c }} />
                  {tr(l)}
                </span>
              ))}
            </div>
          );
        if ("grid" in b)
          return (
            <div key={i} className="grid2">
              {b.grid.map((col, k) => (
                <div key={k}>
                  <DocBlocks blocks={col} onLink={onLink} />
                </div>
              ))}
            </div>
          );
        return null;
      })}
    </>
  );
}
