import React, { useEffect, useState } from "react";
import { blitIndexed, paletteRgba } from "../core/gfx";
import { PaletteStrip, PixelCanvas } from "./common";
import { tr } from "../i18n";

type Tool = "pen" | "fill" | "pick" | "erase";

/** Indexed pixel editor for one w×h image (tiles or whole frames). */
export function PixelEditor({
  width,
  height,
  initial,
  palette,
  title,
  onApply,
  onClose,
  grid = 16,
}: {
  width: number;
  height: number;
  initial: Uint8Array;
  palette: number[];
  title: string;
  onApply: (px: Uint8Array) => void;
  onClose: () => void;
  grid?: number;
}) {
  const [px, setPx] = useState(() => new Uint8Array(initial));
  const [history, setHistory] = useState<Uint8Array[]>([]);
  const [color, setColor] = useState(1);
  const [tool, setTool] = useState<Tool>("pen");
  const [showGrid, setShowGrid] = useState(true);
  const scale = Math.max(4, Math.min(28, Math.floor(560 / Math.max(width, height))));
  const rgba = paletteRgba(palette);

  useEffect(() => setPx(new Uint8Array(initial)), [initial]);

  const snapshot = () => setHistory((h) => [...h.slice(-50), new Uint8Array(px)]);

  const fill = (x: number, y: number, c: number) => {
    const target = px[y * width + x];
    if (target === c) return;
    const n = new Uint8Array(px);
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      if (n[cy * width + cx] !== target) continue;
      n[cy * width + cx] = c;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    setPx(n);
  };

  const onPointer = (x: number, y: number, e: React.PointerEvent) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const right = e.buttons === 2 || e.button === 2;
    const c = right || tool === "erase" ? 0 : color;
    if (e.type === "pointerdown") snapshot();
    if (tool === "pick") {
      setColor(px[y * width + x]);
      setTool("pen");
      return;
    }
    if (tool === "fill") {
      if (e.type === "pointerdown") fill(x, y, c);
      return;
    }
    if (px[y * width + x] === c) return;
    const n = new Uint8Array(px);
    n[y * width + x] = c;
    setPx(n);
  };

  const transform = (fn: (x: number, y: number) => number) => {
    snapshot();
    const n = new Uint8Array(px.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) n[y * width + x] = fn(x, y);
    setPx(n);
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          <div className="checker" style={{ position: "relative" }}>
            <PixelCanvas
              width={width}
              height={height}
              scale={scale}
              deps={[px, palette]}
              draw={(ctx) => {
                const img = ctx.createImageData(width, height);
                if (width === height) blitIndexed(img, px, width, rgba, 0, 0);
                else
                  for (let i = 0; i < px.length; i++) {
                    const c = rgba[px[i]];
                    if (c[3]) img.data.set([c[0], c[1], c[2], 255], i * 4);
                  }
                ctx.putImageData(img, 0, 0);
              }}
              onPointer={onPointer}
            />
            {showGrid && (
              <svg width={width * scale} height={height * scale} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {Array.from({ length: width + 1 }, (_, i) => (
                  <line key={"v" + i} x1={i * scale} y1={0} x2={i * scale} y2={height * scale} stroke={i % grid === 0 ? "#ffb00080" : "#ffffff14"} />
                ))}
                {Array.from({ length: height + 1 }, (_, i) => (
                  <line key={"h" + i} y1={i * scale} x1={0} y2={i * scale} x2={width * scale} stroke={i % grid === 0 ? "#ffb00080" : "#ffffff14"} />
                ))}
              </svg>
            )}
          </div>
          <div className="col" style={{ width: 230 }}>
            <div className="tools">
              {(["pen", "fill", "pick", "erase"] as Tool[]).map((t) => (
                <button key={t} className={"btn sm" + (tool === t ? " on" : "")} onClick={() => setTool(t)}>
                  {{ pen: "✎ Pen", fill: "◍ Fill", pick: "⌖ Pick", erase: "⌫ Erase" }[t]}
                </button>
              ))}
            </div>
            <div className="muted small">{tr("Left click paints the selected color, right click paints transparent (index 0).")}</div>
            <PaletteStrip words={palette} selected={color} onPick={(i) => setColor(i)} size={22} />
            <div className="muted small">{tr("Color index")}{" "}{color}</div>
            <div className="tools">
              <button className="btn sm" onClick={() => transform((x, y) => px[y * width + (width - 1 - x)])}>{tr("⇋ Flip H")}</button>
              <button className="btn sm" onClick={() => transform((x, y) => px[(height - 1 - y) * width + x])}>{tr("⇵ Flip V")}</button>
              <button className="btn sm" onClick={() => transform((x, y) => px[y * width + ((x + 1) % width)])}>{tr("← Shift")}</button>
              <button className="btn sm" onClick={() => transform((x, y) => px[y * width + ((x - 1 + width) % width)])}>{tr("→ Shift")}</button>
              <button className="btn sm" onClick={() => transform((x, y) => px[((y + 1) % height) * width + x])}>{tr("↑ Shift")}</button>
              <button className="btn sm" onClick={() => transform((x, y) => px[((y - 1 + height) % height) * width + x])}>{tr("↓ Shift")}</button>
              <button className="btn sm" onClick={() => transform(() => 0)}>{tr("Clear")}</button>
              <button
                className="btn sm"
                disabled={!history.length}
                onClick={() => {
                  const h = [...history];
                  const last = h.pop();
                  if (last) setPx(last);
                  setHistory(h);
                }}
              >{tr("↶ Undo")}</button>
            </div>
            <label className="f">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />{" "}{tr("grid")}</label>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => onApply(px)}>{tr("Write to ROM")}</button>
              <button className="btn" onClick={onClose}>{tr("Cancel")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
