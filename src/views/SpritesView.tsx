import React, { useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { buildPaletteFromImage, cPairs, findBlankTileRuns, quantizeToPalette, totalCTiles } from "../core/gfx";
import { useApp } from "../store";
import { HexInput, imageFileToRgba, NeedRom, NumInput, Panel, PaletteStrip, pickFile, PixelCanvas, useActivePalette, useRgba } from "../ui/common";
import { PixelEditor } from "../ui/PixelEditor";
import { blockCells, blockPixels, drawIndexed, Order, writeBlock } from "../ui/sprite";
import { tr } from "../i18n";

export function SpritesView() {
  const { rs, version, toast, paletteSource, setPalette, gotoTile } = useApp();
  const pal = useActivePalette();
  const rgba = useRgba(pal);
  const pairs = useMemo(() => (rs ? cPairs(rs) : []), [rs]);
  const [base, setBase] = useState(0);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(6);
  const [order, setOrder] = useState<Order>("colmajor");
  const [scale, setScale] = useState(3);
  const [flip, setFlip] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newPal, setNewPal] = useState<number[] | null>(null);

  const cells = useMemo(() => blockCells(base, cols, rows, order), [base, cols, rows, order]);
  const px = useMemo(() => (rs ? blockPixels(rs, pairs, cells, cols, rows) : new Uint8Array()), [rs, pairs, cells, cols, rows, version]);

  if (!rs) return <NeedRom />;
  const total = totalCTiles(pairs);
  const W = cols * 16, H = rows * 16;

  const importFrame = async (makePalette: boolean) => {
    const f = await pickFile("image/png,image/*");
    if (!f) return;
    const im = await imageFileToRgba(f);
    const c = Math.ceil(im.w / 16), r = Math.ceil(im.h / 16);
    const need = c * r;
    const runs = findBlankTileRuns(rs, pairs, need);
    const target = runs.find((x) => x.count >= need);
    if (!target) return toast(tr("No free run of {n} tiles found. Free space in Sprite tiles → Scan, or overwrite existing tiles by setting the base yourself.", { n: need }), "error");
    let palWords = pal;
    if (makePalette) {
      palWords = buildPaletteFromImage(im.data);
      setNewPal(palWords);
    }
    const idx = quantizeToPalette(im.data, palWords);
    const pxNew = new Uint8Array(c * 16 * r * 16);
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) pxNew[y * c * 16 + x] = idx[y * im.w + x];
    const newCells = blockCells(target.start, c, r, order);
    writeBlock(rs, pairs, newCells, c, pxNew, `import frame ${f.name}`);
    setBase(target.start);
    setCols(c);
    setRows(r);
    toast(tr("Frame written: {c}×{r} tiles at ${addr} ({order} order)", { c, r, addr: hex(target.start, 5), order: tr(order === "colmajor" ? "column" : "row") }), "ok");
  };

  return (
    <div className="split">
      <Panel
        title={tr("Frame builder")}
        actions={
          <>
            <label className="f">{tr("base tile")}{" "}<HexInput value={base} onChange={(v) => setBase(Math.max(0, Math.min(total - 1, v)))} width={70} />
            </label>
            <label className="f">{tr("cols")}{" "}<NumInput value={cols} min={1} max={32} onChange={(v) => setCols(Math.max(1, Math.min(32, v)))} width={50} />
            </label>
            <label className="f">{tr("rows")}{" "}<NumInput value={rows} min={1} max={32} onChange={(v) => setRows(Math.max(1, Math.min(32, v)))} width={50} />
            </label>
            <select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
              <option value="colmajor">{tr("column order (Neo Geo native)")}</option>
              <option value="rowmajor">{tr("row order")}</option>
            </select>
            <select value={scale} onChange={(e) => setScale(+e.target.value)}>
              {[1, 2, 3, 4, 6].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <label className="f">
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />{" "}{tr("flip")}</label>
          </>
        }
      >
        <div className="checker" style={{ display: "inline-block", border: "1px solid #2a3043" }}>
          <PixelCanvas
            width={W}
            height={H}
            scale={scale}
            deps={[px, rgba, flip]}
            draw={(ctx) => drawIndexed(ctx, px, W, H, rgba, 0, 0, flip)}
            onPointer={(x, y, e) => {
              if (e.type !== "pointerdown") return;
              const cx = flip ? cols - 1 - Math.floor(x / 16) : Math.floor(x / 16);
              const t = cells[Math.floor(y / 16) * cols + cx];
              if (e.detail === 2 || e.altKey) gotoTile(t);
            }}
          />
        </div>
        <p className="muted small">{tr("A Neo Geo sprite is a 16 px wide column of tiles; wide characters chain several columns. Tiles are read consecutively from the base tile. Alt+click a tile to open it in the tile browser.")}</p>
      </Panel>
      <div>
        <Panel title={tr("Actions")}>
          <div className="col">
            <button className="btn primary" onClick={() => setEditing(true)}>{tr("✎ Edit whole frame")}</button>
            <button className="btn" onClick={() => importFrame(false)}>{tr("Import PNG frame (use active palette)")}</button>
            <button className="btn" onClick={() => importFrame(true)}>{tr("Import PNG frame + build new palette")}</button>
            <button
              className="btn"
              onClick={() => {
                const c = document.createElement("canvas");
                c.width = W;
                c.height = H;
                drawIndexed(c.getContext("2d")!, px, W, H, rgba);
                c.toBlob((b) => {
                  if (!b) return;
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(b);
                  a.download = `${rs.setName}_frame_${hex(base, 5)}_${cols}x${rows}.png`;
                  a.click();
                });
              }}
            >{tr("Export PNG")}</button>
          </div>
          <p className="muted small">{tr("Imports go to the first free run of empty tiles big enough for the image. Draw your art with at most 15 colors + transparency for best results.")}</p>
        </Panel>
        {newPal && (
          <Panel title={tr("Generated palette")}>
            <PaletteStrip words={newPal} size={20} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => setPalette(newPal, "generated from PNG")}>{tr("Use as active")}</button>
              <button
                className="btn sm"
                disabled={!paletteSource}
                title={paletteSource ? tr("Write over the active ROM palette at ${addr}", { addr: hex(paletteSource.addr) }) : tr("Select a ROM palette first")}
                onClick={() => {
                  if (!paletteSource) return;
                  rs.writeCpu(paletteSource.addr, newPal.flatMap((w) => [w >> 8, w & 255]), paletteSource.bank, "write generated palette");
                  toast(tr("Palette written to ROM"), "ok");
                }}
              >{tr("Write into active ROM palette")}</button>
            </div>
          </Panel>
        )}
        <Panel title={tr("Tiles in this frame")}>
          <div className="mono small" style={{ maxHeight: 200, overflow: "auto" }}>
            {Array.from({ length: cols }, (_, c) => (
              <div key={c}>{tr("col")}{" "}{c}: ${hex(cells[c], 5)}…${hex(cells[(rows - 1) * cols + c], 5)}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {editing && (
        <PixelEditor
          width={W}
          height={H}
          title={tr("Frame at ${addr} ({c}×{r})", { addr: hex(base, 5), c: cols, r: rows })}
          initial={px}
          palette={pal}
          onClose={() => setEditing(false)}
          onApply={(np) => {
            writeBlock(rs, pairs, cells, cols, np, "edit frame");
            setEditing(false);
            toast(tr("Frame written"), "ok");
          }}
        />
      )}
    </div>
  );
}
