import React, { useEffect, useMemo, useRef, useState } from "react";
import { hex, parseNum } from "../core/bytes";
import { paletteRgba, readPalette, rgbCss } from "../core/gfx";
import { useApp } from "../store";
import { tr } from "../i18n";

/** Active palette words; follows ROM edits when the palette came from the ROM. */
export function useActivePalette(): number[] {
  const { rs, palette, paletteSource, version } = useApp();
  return useMemo(() => {
    if (rs && paletteSource) return readPalette(rs, paletteSource.addr, paletteSource.bank);
    return palette;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs, palette, paletteSource, version]);
}

export function useRgba(words: number[]) {
  return useMemo(() => paletteRgba(words), [words]);
}

export function HexInput({
  value,
  onChange,
  width = 90,
  prefix = "$",
  digits = 0,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  width?: number;
  prefix?: string;
  digits?: number;
  title?: string;
}) {
  const [text, setText] = useState(hex(value, digits));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(hex(value, digits)), [value, digits]);
  const commit = () => {
    const v = parseNum(text.startsWith("#") ? text : "$" + text.replace(/^\$/, "").replace(/^0x/i, ""));
    if (v === null) setBad(true);
    else {
      setBad(false);
      onChange(v);
    }
  };
  return (
    <span className={"hexinput" + (bad ? " bad" : "")} title={title}>
      {prefix && <span className="pre">{prefix}</span>}
      <input
        style={{ width }}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = e.shiftKey ? 16 : 1;
            onChange(Math.max(0, value + (e.key === "ArrowUp" ? step : -step)));
          }
        }}
      />
    </span>
  );
}

export function NumInput({ value, onChange, min, max, width = 60 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; width?: number }) {
  return (
    <input
      type="number"
      className="num"
      style={{ width }}
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
    />
  );
}

export function Panel({ title, actions, children, className = "", scroll = false }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; scroll?: boolean }) {
  return (
    <section className={"panel " + className}>
      {(title || actions) && (
        <header>
          <h3>{title}</h3>
          <div className="actions">{actions}</div>
        </header>
      )}
      <div className={"body" + (scroll ? " scroll" : "")}>{children}</div>
    </section>
  );
}

export function PaletteStrip({
  words,
  selected,
  onPick,
  size = 18,
}: {
  words: number[];
  selected?: number;
  onPick?: (i: number, e: React.MouseEvent) => void;
  size?: number;
}) {
  return (
    <div className="palstrip">
      {words.map((w, i) => (
        <button
          key={i}
          className={"sw" + (i === 0 ? " zero" : "") + (selected === i ? " sel" : "")}
          style={{ width: size, height: size, background: i === 0 ? undefined : rgbCss(w) }}
          title={`#${i}  $${hex(w, 4)}`}
          onClick={(e) => onPick?.(i, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            onPick?.(i, e);
          }}
        />
      ))}
    </div>
  );
}

export function ActivePaletteBadge() {
  const { paletteName, setTab } = useApp();
  const words = useActivePalette();
  return (
    <div className="palbadge" onClick={() => setTab("palettes")} title={tr("Active palette — click to choose another")}>
      <PaletteStrip words={words} size={12} />
      <span>{tr(paletteName)}</span>
    </div>
  );
}

/** Canvas with pixelated scaling that redraws through `draw`. */
export function PixelCanvas({
  width,
  height,
  scale,
  draw,
  deps,
  onPointer,
  className,
  style,
}: {
  width: number;
  height: number;
  scale: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
  deps: unknown[];
  onPointer?: (x: number, y: number, e: React.PointerEvent<HTMLCanvasElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, ...deps]);
  const handler = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onPointer) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * height);
    onPointer(x, y, e);
  };
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={"pixel " + (className ?? "")}
      style={{ width: width * scale, height: height * scale, ...style }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        handler(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) handler(e);
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function NeedRom() {
  const { setTab } = useApp();
  return (
    <Empty>
      <p>{tr("Load a ROM set first.")}</p>
      <button className="btn primary" onClick={() => setTab("home")}>{tr("Open ROM set")}</button>
    </Empty>
  );
}

export function Addr({ a, bank, digits = 6 }: { a: number; bank?: number; digits?: number }) {
  const { gotoCode, labelFor } = useApp();
  const label = labelFor(a);
  return (
    <a className="addr" onClick={() => gotoCode(a, bank)} title={label ? tr("{label} — open in code view", { label }) : tr("Open in code view")}>
      ${hex(a, digits)}
      {label ? <span className="lbl"> {label}</span> : null}
    </a>
  );
}

export async function imageFileToRgba(file: File): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToPng(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((b) => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

export function downloadBytes(bytes: Uint8Array, name: string, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
  });
}
