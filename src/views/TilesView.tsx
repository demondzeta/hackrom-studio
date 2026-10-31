import React, { useEffect, useMemo, useRef, useState } from "react";
import { hex } from "../core/bytes";
import { blitIndexed, cPairs, decodeCTile, findBlankTileRuns, locateCTile, quantizeToPalette, totalCTiles, writeCTile } from "../core/gfx";
import { useApp } from "../store";
import { canvasToPng, Empty, HexInput, imageFileToRgba, NeedRom, Panel, pickFile, useActivePalette, useRgba } from "../ui/common";
import { PixelEditor } from "../ui/PixelEditor";
import { tr } from "../i18n";

let clipboard: { w: number; h: number; tiles: Uint8Array[] } | null = null;

export function TilesView() {
  const { rs, version, tile, toast } = useApp();
  const pal = useActivePalette();
  const rgba = useRgba(pal);
  const pairs = useMemo(() => (rs ? cPairs(rs) : []), [rs]);
  const total = totalCTiles(pairs);
  const [cols, setCols] = useState(32);
  const [scale, setScale] = useState(2);
  const rows = Math.max(8, Math.floor(640 / (16 * scale)));
  const [first, setFirst] = useState(0);
  const [sel, setSel] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [editing, setEditing] = useState<number | null>(null);
  const [free, setFree] = useState<{ start: number; count: number }[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (tile.nonce) {
      setFirst(Math.max(0, Math.floor(tile.n / cols) * cols - cols * 2));
      setSel({ a: tile.n, b: tile.n });
    }
  }, [tile.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = cols * 16, H = rows * 16;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !rs) return;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const buf = new Uint8Array(256);
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const t = first + r * cols + k;
        if (t >= total) continue;
        decodeCTile(rs, pairs, t, buf);
        blitIndexed(img, buf, 16, rgba, k * 16, r * 16);
      }
    ctx.putImageData(img, 0, 0);
  }, [rs, version, first, cols, rows, rgba, pairs, total, W, H]);

  if (!rs) return <NeedRom />;
  if (!pairs.length) return <Empty>{tr("This set has no C-ROM pairs (c1/c2…).")}</Empty>;

  const rc = (t: number) => ({ r: Math.floor(t / cols), c: t % cols });
  const A = rc(sel.a), B = rc(sel.b);
  const r0 = Math.min(A.r, B.r), r1 = Math.max(A.r, B.r), c0 = Math.min(A.c, B.c), c1 = Math.max(A.c, B.c);
  const selW = c1 - c0 + 1, selH = r1 - r0 + 1;
  const selTiles: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) selTiles.push(r * cols + c);
  const loc = locateCTile(pairs, sel.a);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (16 * scale));
    const y = Math.floor((e.clientY - rect.top) / (16 * scale));
    const t = first + y * cols + x;
    if (t >= total) return;
    if (e.shiftKey) setSel((s) => ({ a: s.a, b: t }));
    else setSel({ a: t, b: t });
  };

  const jump = (t: number) => {
    const n = Math.max(0, Math.min(total - 1, t));
    setFirst(Math.floor(n / cols) * cols);
    setSel({ a: n, b: n });
  };

  const exportPng = () => {
    const c = document.createElement("canvas");
    c.width = selW * 16;
    c.height = selH * 16;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    const buf = new Uint8Array(256);
    selTiles.forEach((t, i) => {
      decodeCTile(rs, pairs, t, buf);
      blitIndexed(img, buf, 16, rgba, (i % selW) * 16, Math.floor(i / selW) * 16);
    });
    ctx.putImageData(img, 0, 0);
    canvasToPng(c, `${rs.setName}_tiles_${hex(selTiles[0], 5)}_${selW}x${selH}.png`);
  };

  const importPng = async () => {
    const f = await pickFile("image/png,image/*");
    if (!f) return;
    const im = await imageFileToRgba(f);
    const tw = Math.ceil(im.w / 16), th = Math.ceil(im.h / 16);
    const idx = quantizeToPalette(im.data, pal);
    const startR = r0, startC = c0;
    rs.batch(`import PNG ${f.name}`, () => {
      for (let ty = 0; ty < th; ty++)
        for (let tx = 0; tx < tw; tx++) {
          const t = (startR + ty) * cols + startC + tx;
          if (startC + tx >= cols || t >= total) continue;
          const px = new Uint8Array(256);
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
              const sx = tx * 16 + x, sy = ty * 16 + y;
              if (sx < im.w && sy < im.h) px[y * 16 + x] = idx[sy * im.w + sx];
            }
          writeCTile(rs, pairs, t, px, "import png");
        }
    });
    toast(tr("Imported {w}×{h} tiles at ${addr} using the active palette", { w: tw, h: th, addr: hex(selTiles[0]) }), "ok");
  };

  const copy = () => {
    clipboard = { w: selW, h: selH, tiles: selTiles.map((t) => decodeCTile(rs, pairs, t)) };
    toast(`Copied ${selTiles.length} tile(s)`);
  };
  const paste = () => {
    if (!clipboard) return;
    const cb = clipboard;
    rs.batch("paste tiles", () => {
      cb.tiles.forEach((px, i) => {
        const t = (r0 + Math.floor(i / cb.w)) * cols + c0 + (i % cb.w);
        if (t < total) writeCTile(rs, pairs, t, px, "paste");
      });
    });
    toast(`Pasted ${cb.tiles.length} tile(s)`, "ok");
  };
  const clear = () => {
    rs.batch("clear tiles", () => selTiles.forEach((t) => writeCTile(rs, pairs, t, new Uint8Array(256), "clear")));
  };

  const firstRow = Math.floor(first / cols);
  const maxRow = Math.max(0, Math.ceil(total / cols) - rows);

  return (
    <div className="split">
      <div>
        <Panel
          title={tr("C-ROM sprite tiles")}
          actions={
            <>
              <label className="f">{tr("go to tile")}{" "}<HexInput value={sel.a} onChange={jump} width={70} />
              </label>
              <select value={cols} onChange={(e) => setCols(+e.target.value)}>
                {[8, 16, 32, 48].map((n) => (
                  <option key={n} value={n}>
                    {n}{" "}{tr("per row")}</option>
                ))}
              </select>
              <select value={scale} onChange={(e) => setScale(+e.target.value)}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}{tr("× zoom")}</option>
                ))}
              </select>
            </>
          }
        >
          <div className="tiles-wrap">
            <div
              className="tilegrid checker"
              style={{ width: W * scale, height: H * scale }}
              onClick={onClick}
              onDoubleClick={() => setEditing(sel.a)}
              onWheel={(e) => {
                const d = Math.sign(e.deltaY) * cols * (e.shiftKey ? rows : 3);
                setFirst((f) => Math.max(0, Math.min(maxRow * cols, f + d)));
              }}
            >
              <canvas ref={canvasRef} width={W} height={H} className="pixel" style={{ width: W * scale, height: H * scale }} />
              {r1 >= firstRow && r0 < firstRow + rows && (
                <div
                  style={{
                    position: "absolute",
                    left: c0 * 16 * scale,
                    top: (r0 - firstRow) * 16 * scale,
                    width: selW * 16 * scale,
                    height: selH * 16 * scale,
                    outline: "2px solid #ffb000",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
            <input
              type="range"
              className="vscroll"
              min={0}
              max={maxRow}
              value={firstRow}
              onChange={(e) => setFirst(+e.target.value * cols)}
              style={{ height: H * scale }}
            />
          </div>
          <div className="row muted small" style={{ marginTop: 6 }}>{tr("Tiles ${a}–${b} of ${t} ({n}). Wheel to scroll (Shift = page), click to select, Shift+click for a block, double-click to edit.", { a: hex(first), b: hex(Math.min(total, first + rows * cols) - 1), t: hex(total), n: total.toLocaleString() })}</div>
        </Panel>
      </div>
      <div>
        <Panel title={selTiles.length > 1 ? `Selection ${selW}×${selH}` : `Tile $${hex(sel.a, 5)}`}>
          <div className="kv mono">
            <span>{tr("tile")}</span>
            <span>
              ${hex(sel.a, 5)} ({sel.a})
            </span>
            {loc && (
              <>
                <span>{tr("pair")}</span>
                <span>
                  {rs.files[loc.pair.odd].name} / {rs.files[loc.pair.even].name}
                </span>
                <span>{tr("planes 0-1")}</span>
                <span>
                  {rs.files[loc.pair.odd].name} @ ${hex(loc.offset, 6)}
                </span>
                <span>{tr("planes 2-3")}</span>
                <span>
                  {rs.files[loc.pair.even].name} @ ${hex(loc.offset, 6)}
                </span>
                <span>{tr("combined addr")}</span>
                <span>{tr("${o} (128 bytes/tile)", { o: hex(sel.a * 128, 7) })}</span>
              </>
            )}
            {selTiles.length > 1 && (
              <>
                <span>{tr("block")}</span>
                <span>
                  {selW}×{selH}{" "}{tr("tiles =")}{" "}{selW * 16}×{selH * 16}{tr("px")}</span>
              </>
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => setEditing(sel.a)}>{tr("✎ Edit tile")}</button>
            <button className="btn" onClick={exportPng}>{tr("Export PNG")}</button>
            <button className="btn" onClick={importPng} title={tr("PNG is placed at the selection's top-left, row by row, colors matched to the active palette")}>{tr("Import PNG")}</button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={copy}>{tr("Copy")}</button>
            <button className="btn sm" disabled={!clipboard} onClick={paste}>{tr("Paste")}</button>
            <button className="btn sm danger" onClick={clear}>{tr("Clear")}</button>
          </div>
          <p className="muted small">{tr("Tip: pick the right palette first (Palettes tab or a character in Characters & moves) so imported art maps to the right colors.")}</p>
        </Panel>
        <Panel
          title={tr("Free tile space")}
          actions={
            <button className="btn sm" onClick={() => setFree(findBlankTileRuns(rs, pairs, 32))}>{tr("Scan")}</button>
          }
        >
          {free === null ? (
            <p className="muted">{tr("Find runs of empty tiles where you can put new graphics (new frames, a new character).")}</p>
          ) : free.length === 0 ? (
            <p className="muted">{tr("No runs of 32+ empty tiles.")}</p>
          ) : (
            <table className="t">
              <tbody>
                {free.slice(0, 40).map((f) => (
                  <tr key={f.start} className="click" onClick={() => jump(f.start)}>
                    <td className="mono">${hex(f.start, 5)}</td>
                    <td>{f.count.toLocaleString()}{" "}{tr("tiles")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      {editing !== null && (
        <PixelEditor
          width={16}
          height={16}
          title={tr("Edit tile ${n}", { n: hex(editing, 5) })}
          initial={decodeCTile(rs, pairs, editing)}
          palette={pal}
          onClose={() => setEditing(null)}
          onApply={(px) => {
            writeCTile(rs, pairs, editing, px, `edit tile ${hex(editing)}`);
            setEditing(null);
            toast(`Tile $${hex(editing)} written`, "ok");
          }}
        />
      )}
    </div>
  );
}
