import React, { useEffect, useRef, useState } from "react";
import { hex } from "../core/bytes";
import { blitIndexed, decodeSTile, encodeSTile } from "../core/gfx";
import { useApp } from "../store";
import { canvasToPng, Empty, HexInput, NeedRom, Panel, useActivePalette, useRgba } from "../ui/common";
import { PixelEditor } from "../ui/PixelEditor";
import { tr } from "../i18n";

export function FixView() {
  const { rs, version, toast } = useApp();
  const pal = useActivePalette();
  const rgba = useRgba(pal);
  const sFiles = rs ? rs.filesByRole("s") : [];
  const [fileIdx, setFileIdx] = useState(0);
  const [first, setFirst] = useState(0);
  const [sel, setSel] = useState(0);
  const [editing, setEditing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cols = 32, rows = 32, scale = 3;
  const file = sFiles[fileIdx];
  const total = file ? file.f.data.length / 32 : 0;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !file) return;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(cols * 8, rows * 8);
    const buf = new Uint8Array(64);
    for (let i = 0; i < cols * rows; i++) {
      const t = first + i;
      if (t >= total) break;
      decodeSTile(file.f.data, t, buf);
      blitIndexed(img, buf, 8, rgba, (i % cols) * 8, Math.floor(i / cols) * 8);
    }
    ctx.putImageData(img, 0, 0);
  }, [file, first, rgba, version, total]);

  if (!rs) return <NeedRom />;
  if (!file) return <Empty>{tr("This set has no S-ROM (fix layer). Some games keep the fix layer in the BIOS SFIX or in C-ROM.")}</Empty>;

  const firstRow = first / cols;
  const maxRow = Math.max(0, Math.ceil(total / cols) - rows);

  return (
    <div className="split">
      <Panel
        title={tr("Fix layer tiles (8×8)")}
        actions={
          <>
            {sFiles.length > 1 && (
              <select value={fileIdx} onChange={(e) => setFileIdx(+e.target.value)}>
                {sFiles.map((s, i) => (
                  <option key={s.i} value={i}>
                    {s.f.name}
                  </option>
                ))}
              </select>
            )}
            <label className="f">{tr("go to")}{" "}<HexInput value={sel} onChange={(v) => { setSel(v); setFirst(Math.floor(v / cols) * cols); }} width={60} />
            </label>
            <button className="btn sm" onClick={() => canvasRef.current && canvasToPng(canvasRef.current, `${rs.setName}_fix_${hex(first, 4)}.png`)}>{tr("Export page PNG")}</button>
          </>
        }
      >
        <div className="tiles-wrap">
          <div
            className="tilegrid checker"
            style={{ width: cols * 8 * scale, height: rows * 8 * scale }}
            onWheel={(e) => setFirst((f) => Math.max(0, Math.min(maxRow * cols, f + Math.sign(e.deltaY) * cols * 4)))}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const t = first + Math.floor((e.clientY - r.top) / (8 * scale)) * cols + Math.floor((e.clientX - r.left) / (8 * scale));
              if (t < total) setSel(t);
            }}
            onDoubleClick={() => setEditing(true)}
          >
            <canvas ref={canvasRef} width={cols * 8} height={rows * 8} className="pixel" style={{ width: cols * 8 * scale, height: rows * 8 * scale }} />
            {sel >= first && sel < first + cols * rows && (
              <div
                style={{
                  position: "absolute",
                  left: ((sel - first) % cols) * 8 * scale,
                  top: Math.floor((sel - first) / cols) * 8 * scale,
                  width: 8 * scale,
                  height: 8 * scale,
                  outline: "2px solid #ffb000",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
          <input type="range" className="vscroll" min={0} max={maxRow} value={firstRow} onChange={(e) => setFirst(+e.target.value * cols)} style={{ height: rows * 8 * scale }} />
        </div>
      </Panel>
      <Panel title={tr("Fix tile ${n}", { n: hex(sel, 4) })}>
        <div className="kv mono">
          <span>{tr("tile")}</span>
          <span>${hex(sel, 4)}</span>
          <span>{tr("file")}</span>
          <span>{file.f.name}</span>
          <span>{tr("offset")}</span>
          <span>{tr("${o} (32 bytes)", { o: hex(sel * 32, 6) })}</span>
        </div>
        <p className="muted small">{tr("Fix tiles draw the HUD, timer, fonts and text. The fix layer uses palettes 0–15; pick a matching palette to see real colors.")}</p>
        <button className="btn primary" onClick={() => setEditing(true)}>{tr("✎ Edit tile")}</button>
      </Panel>
      {editing && (
        <PixelEditor
          width={8}
          height={8}
          grid={8}
          title={tr("Edit fix tile ${n}", { n: hex(sel, 4) })}
          initial={decodeSTile(file.f.data, sel)}
          palette={pal}
          onClose={() => setEditing(false)}
          onApply={(px) => {
            rs.write(file.i, sel * 32, encodeSTile(px), `fix tile ${hex(sel)}`);
            setEditing(false);
            toast(tr("Fix tile written"), "ok");
          }}
        />
      )}
    </div>
  );
}
