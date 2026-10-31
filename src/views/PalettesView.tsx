import React, { useMemo, useState } from "react";
import { hex, parseHexBytes } from "../core/bytes";
import { hexToRgb, ngToRgb, readPalette, rgbCss, rgbHex, rgbToNg } from "../core/gfx";
import type { RomSet } from "../core/romset";
import { KOF_PALETTES } from "../games/kofPalettes";
import { useApp } from "../store";
import { HexInput, NeedRom, Panel, PaletteStrip } from "../ui/common";
import { LiveButton } from "../live/live";
import { tr } from "../i18n";


export function p2OffsetToCpu(rs: RomSet, off: number): { addr: number; bank: number } | null {
  for (let i = 0; i < rs.banks.length; i++) {
    const b = rs.banks[i];
    if (off >= b.offset && off < b.offset + 0x100000) return { bank: i, addr: 0x200000 + off - b.offset };
  }
  return null;
}

function scanPalettes(rs: RomSet): { addr: number; bank: number; score: number }[] {
  const out: { addr: number; bank: number; score: number }[] = [];
  const areas: { bank: number; lo: number; hi: number }[] = [{ bank: 0, lo: 0x400, hi: 0x100000 }];
  rs.banks.forEach((_, i) => areas.push({ bank: i, lo: 0x200000, hi: 0x300000 }));
  for (const ar of areas) {
    const loc = rs.cpuToFile(ar.lo, ar.bank);
    if (!loc) continue;
    const d = rs.files[loc.file].data;
    const base = loc.offset;
    for (let a = 0; a + 32 <= ar.hi - ar.lo && base + a + 32 <= d.length; a += 32) {
      const o = base + a;
      const w0 = (d[o] << 8) | d[o + 1];
      if (w0 !== 0x8000 && w0 !== 0x0000 && w0 !== 0x0f0f) continue;
      const seen = new Set<number>();
      let ffff = 0, smooth = 0;
      let prev = -1;
      for (let i = 1; i < 16; i++) {
        const w = (d[o + i * 2] << 8) | d[o + i * 2 + 1];
        seen.add(w);
        if (w === 0xffff) ffff++;
        if (prev >= 0) {
          const [r1, g1, b1] = ngToRgb(prev), [r2, g2, b2] = ngToRgb(w);
          if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < 140) smooth++;
        }
        prev = w;
      }
      if (ffff > 1 || seen.size < 8) continue;
      const score = seen.size + smooth;
      if (score >= 20) out.push({ addr: ar.lo + a, bank: ar.bank, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 400);
}

export function PalettesView() {
  const { rs, profile, version, setPalette, paletteSource, toast } = useApp();
  const [addr, setAddr] = useState(0x200000);
  const [bank, setBank] = useState(() => (rs?.banks.length ? Math.min(2, rs.banks.length - 1) : 0));
  const [selRow, setSelRow] = useState(0);
  const [selColor, setSelColor] = useState(1);
  const [filter, setFilter] = useState("");
  const [scan, setScan] = useState<{ addr: number; bank: number; score: number }[] | null>(null);
  const [livePal, setLivePal] = useState(0x010);

  const library = profile.paletteSet ? KOF_PALETTES[profile.paletteSet] ?? [] : [];
  const groups = useMemo(() => {
    const m = new Map<string, typeof library>();
    for (const e of library) {
      const k = e.name + (e.zh ? ` (${e.zh})` : "");
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()];
  }, [library]);

  if (!rs) return <NeedRom />;

  const rowAddr = (r: number) => addr + r * 32;
  const rows = Array.from({ length: 16 }, (_, r) => readPalette(rs, rowAddr(r), bank));
  void version;
  const cur = rows[selRow];
  const curWord = cur[selColor];
  const [r8, g8, b8] = ngToRgb(curWord);
  const r5 = ((curWord >> 7) & 0x1e) | ((curWord >> 14) & 1);
  const g5 = ((curWord >> 3) & 0x1e) | ((curWord >> 13) & 1);
  const b5 = ((curWord << 1) & 0x1e) | ((curWord >> 12) & 1);
  const dark = (curWord >> 15) & 1;

  const writeColor = (w: number) => {
    try {
      rs.writeCpu(rowAddr(selRow) + selColor * 2, [(w >> 8) & 0xff, w & 0xff], bank, `palette ${hex(rowAddr(selRow))}[${selColor}]`);
    } catch (e: any) {
      toast(e.message, "error");
    }
  };
  const from5 = (r: number, g: number, b: number, d: number) =>
    (d << 15) | ((r & 1) << 14) | ((g & 1) << 13) | ((b & 1) << 12) | ((r >> 1) << 8) | ((g >> 1) << 4) | (b >> 1);

  const useRow = (r: number) => {
    setSelRow(r);
    setPalette(rows[r], `$${hex(rowAddr(r), 6)}${rs.banks.length ? " bank " + bank : ""}`, { addr: rowAddr(r), bank });
  };

  const go = (a: number, b: number, name?: string) => {
    setAddr(a);
    setBank(b);
    setSelRow(0);
    setPalette(readPalette(rs, a, b), name ?? `$${hex(a, 6)}`, { addr: a, bank: b });
  };

  const isActive = (r: number) => paletteSource && paletteSource.addr === rowAddr(r) && paletteSource.bank === bank;

  return (
    <div className="split3">
      <Panel title={tr("Palette library")} scroll>
        {library.length ? (
          <>
            <input type="text" placeholder={tr("filter characters…")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
            {groups
              .filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()))
              .map(([k, list]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{k}</div>
                  <div className="row">
                    {list.map((e) => {
                      // the notes list colors 1-15; the palette (with transparent color 0) starts 2 bytes earlier
                      const loc = p2OffsetToCpu(rs, e.p2 - 2);
                      return (
                        <button
                          key={e.p2}
                          className="btn sm"
                          disabled={!loc}
                          title={tr("P2 offset ${off} · hardware palette ${n}", { off: hex(e.p2 - 2, 6), n: hex(e.palNum, 3) })}
                          onClick={() => loc && go(loc.addr, loc.bank, `${e.name} ${e.variant}`)}
                        >
                          {e.variant}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            <p className="muted small">{tr("Each button opens that color set (16 palettes, 0x200 bytes). Row 0 is usually the body palette.")}</p>
          </>
        ) : (
          <p className="muted">{tr("No named palettes for this game. Use “Scan for palettes” or browse an address.")}</p>
        )}
        <hr style={{ borderColor: "#2a3043" }} />
        <button className="btn" onClick={() => setScan(scanPalettes(rs))}>{tr("Scan for palettes")}</button>
        {scan && (
          <table className="t" style={{ marginTop: 8 }}>
            <tbody>
              {scan.slice(0, 200).map((s) => (
                <tr key={s.addr + "_" + s.bank} className="click" onClick={() => go(s.addr, s.bank)}>
                  <td className="mono">${hex(s.addr, 6)}</td>
                  <td>{rs.banks.length && s.addr >= 0x200000 ? "b" + s.bank : ""}</td>
                  <td>
                    <PaletteStrip words={readPalette(rs, s.addr, s.bank)} size={8} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title={tr("Palette browser")}
        actions={
          <>
            <HexInput value={addr} onChange={(v) => setAddr(v & 0xfffffe)} width={70} />
            {rs.banks.length > 0 && addr >= 0x200000 && (
              <select value={bank} onChange={(e) => setBank(+e.target.value)}>
                {rs.banks.map((_, i) => (
                  <option key={i} value={i}>{tr("bank")}{" "}{i}
                  </option>
                ))}
              </select>
            )}
            <button className="btn sm" onClick={() => setAddr((a) => Math.max(0, a - 0x200))}>
              ⇞
            </button>
            <button className="btn sm" onClick={() => setAddr((a) => Math.max(0, a - 2))} title={tr("shift 1 color back")}>
              −2
            </button>
            <button className="btn sm" onClick={() => setAddr((a) => a + 2)} title={tr("shift 1 color forward")}>
              +2
            </button>
            <button className="btn sm" onClick={() => setAddr((a) => a + 0x200)}>
              ⇟
            </button>
          </>
        }
      >
        <div className="palgrid">
          {rows.map((p, r) => (
            <div key={r} className={"palrow" + (r === selRow ? " sel" : "")}>
              <span className="lbl" onClick={() => useRow(r)} title={tr("Use as active palette")}>
                {isActive(r) ? "● " : ""}${hex(rowAddr(r), 6)}
              </span>
              <PaletteStrip
                words={p}
                size={22}
                selected={r === selRow ? selColor : undefined}
                onPick={(i) => {
                  setSelRow(r);
                  setSelColor(i);
                }}
              />
            </div>
          ))}
        </div>
        <p className="muted small">{tr("Click an address to make that palette active for the tile views. Click a swatch to edit it on the right.")}</p>
      </Panel>

      <Panel title={tr("Color {n} of ${addr}", { n: selColor, addr: hex(rowAddr(selRow), 6) })}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ width: 80, height: 80, borderRadius: 10, background: rgbCss(curWord), border: "1px solid #0006" }} />
          <div className="kv mono">
            <span>{tr("word")}</span>
            <span>${hex(curWord, 4)}</span>
            <span>{tr("rgb")}</span>
            <span>
              {r8},{g8},{b8}
            </span>
            <span>{tr("html")}</span>
            <span>{rgbHex(curWord)}</span>
          </div>
        </div>
        <div className="col" style={{ marginTop: 10 }}>
          {([
            ["R", r5, (v: number) => writeColor(from5(v, g5, b5, dark))],
            ["G", g5, (v: number) => writeColor(from5(r5, v, b5, dark))],
            ["B", b5, (v: number) => writeColor(from5(r5, g5, v, dark))],
          ] as const).map(([n, v, set]) => (
            <label key={n} className="f">
              <b style={{ width: 14 }}>{n}</b>
              <input type="range" min={0} max={31} value={v} onChange={(e) => set(+e.target.value)} style={{ width: 200 }} />
              <span className="mono">{v}</span>
            </label>
          ))}
          <label className="f">
            <input type="checkbox" checked={!!dark} onChange={(e) => writeColor(from5(r5, g5, b5, e.target.checked ? 1 : 0))} />{" "}{tr("dark bit (slightly darker)")}</label>
          <label className="f">{tr("pick")}{" "}<input type="color" value={rgbHex(curWord)} onChange={(e) => writeColor(rgbToNg(...hexToRgb(e.target.value)))} />
          </label>
          <label className="f">{tr("word")}{" "}<HexInput value={curWord} digits={4} onChange={(v) => writeColor(v & 0xffff)} width={50} />
          </label>
        </div>
        <h4>{tr("Whole palette")}</h4>
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              navigator.clipboard?.writeText(cur.map((w) => hex(w, 4)).join(" "));
              toast(tr("Copied 16 words"));
            }}
          >{tr("Copy hex")}</button>
          <button
            className="btn sm"
            onClick={async () => {
              const t = await navigator.clipboard?.readText();
              const b = t ? parseHexBytes(t) : null;
              if (!b || b.length !== 32) return toast(tr("Clipboard needs 16 hex words"), "error");
              rs.writeCpu(rowAddr(selRow), b, bank, "paste palette");
            }}
          >{tr("Paste hex")}</button>
          <button
            className="btn sm"
            onClick={() => {
              const words = cur.map((w, i) => {
                if (i === 0) return w;
                const [r, g, b] = ngToRgb(w);
                const l = (r + g + b) / 3;
                return rgbToNg(l, l, l);
              });
              rs.writeCpu(rowAddr(selRow), words.flatMap((w) => [w >> 8, w & 255]), bank, "greyscale palette");
            }}
          >{tr("Greyscale")}</button>
          <button
            className="btn sm"
            onClick={() => {
              const words = cur.map((w, i) => {
                if (i === 0) return w;
                const [r, g, b] = ngToRgb(w);
                return rgbToNg(b, r, g);
              });
              rs.writeCpu(rowAddr(selRow), words.flatMap((w) => [w >> 8, w & 255]), bank, "rotate hue");
            }}
          >{tr("Rotate RGB")}</button>
        </div>
        <h4>{tr("Live (temporary)")}</h4>
        <div className="row">
          <label className="f">{tr("palette RAM #")}<HexInput value={livePal} onChange={(v) => setLivePal(v & 0xff)} width={34} />
          </label>
          <LiveButton label={tr("Send this palette")} cmds={() => [`pal ${hex(livePal, 2)} ${cur.map((w) => hex(w, 4)).join("")}`]} title={tr("Writes the 16 colors into the running game's palette RAM")} />
        </div>
        <p className="muted small">{tr("KOF97: P1's character uses palette $010. The game copies ROM palettes into palette RAM at round start, so this shows the change immediately instead of waiting for the next round.")}</p>
        <p className="muted small">{tr("Neo Geo colors are 5 bits per channel plus a shared “dark” bit. Color 0 of a sprite palette is transparent. Edits are written straight into the ROM and every view updates.")}</p>
      </Panel>
    </div>
  );
}
