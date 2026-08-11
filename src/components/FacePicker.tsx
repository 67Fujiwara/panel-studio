import { useMemo } from 'react';
import { FACES, faceSize } from '../data/faces';
import { buildBom, totalHeatW } from '../lib/bom';
import { asciiFileName, bomToCsv, downloadCsv, machiningToCsv } from '../lib/csv';
import { autoLayout } from '../lib/layout';
import { derivedMachining } from '../lib/machining';
import { deviceLookup, useStore } from '../store';
import type { BomSettings, FaceId, PanelSpec } from '../types';

/** 展開図の面と面のすき間(mm 相当) */
const GAP = 14;

type Cell = { id: FaceId; x: number; y: number; w: number; h: number };

/**
 * 制御盤を展開した図の配置を組み立てる。
 * 中央に正面（扉）、その左右に側面、上下に上面・底面、右端に背面を置く。
 * 中板は箱の一部ではないので、下に離して置く。
 */
function unfold(panel: PanelSpec): { cells: Cell[]; w: number; h: number } {
  const { w: W, h: H, d: D } = panel.outer;
  const { w: pw, h: ph } = panel.plate;

  const xLeft = 0;
  const xDoor = D + GAP;
  const xRight = xDoor + W + GAP;
  const xBack = xRight + D + GAP;

  const yTop = 0;
  const yMid = D + GAP;
  const yBottom = yMid + H + GAP;
  const yPlate = yBottom + D + GAP * 3;

  const cells: Cell[] = [
    { id: 'top', x: xDoor, y: yTop, w: W, h: D },
    { id: 'left', x: xLeft, y: yMid, w: D, h: H },
    { id: 'door', x: xDoor, y: yMid, w: W, h: H },
    { id: 'right', x: xRight, y: yMid, w: D, h: H },
    { id: 'back', x: xBack, y: yMid, w: W, h: H },
    { id: 'bottom', x: xDoor, y: yBottom, w: W, h: D },
    { id: 'plate', x: xDoor, y: yPlate, w: pw, h: ph },
  ];

  return { cells, w: xBack + W, h: yPlate + ph };
}

/**
 * 面の選択画面。
 * 左は制御盤の展開図。面を押すとその面のレイアウト画面に移る。
 * BOM は面ごとではなく盤単位のものなので、右にまとめて出す。
 */
export function FacePicker() {
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const items = useStore((s) => s.items);
  const pinned = useStore((s) => s.pinned);
  const machining = useStore((s) => s.machining);
  const devices = useStore((s) => s.devices);
  const myDevices = useStore((s) => s.myDevices);
  const openFace = useStore((s) => s.openFace);
  const setBom = useStore((s) => s.setBom);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);

  const layouts = useMemo(
    () => FACES.map((f) => autoLayout(panel, profile, f.id, items, pinned, lookup)),
    [panel, profile, items, pinned, lookup],
  );

  const bom = buildBom(layouts, profile, lookup);
  const heat = totalHeatW(layouts, lookup);
  const cutouts = [...layouts.flatMap((l) => derivedMachining(l.placed, lookup)), ...machining];
  const base = asciiFileName(panel.model, 'panel');

  const { cells, w: diagW, h: diagH } = unfold(panel);
  // 図の大きさが変わっても文字が読める大きさになるよう、図の寸法に対する比で決める
  const fs = Math.max(diagW, diagH) / 42;

  const countsOf = (id: FaceId) => {
    const i = FACES.findIndex((f) => f.id === id);
    return {
      devs: items.filter((it) => it.face === id).length,
      cuts:
        (i >= 0 ? derivedMachining(layouts[i]!.placed, lookup).length : 0) +
        machining.filter((m) => m.face === id).length,
    };
  };

  return (
    <div className="facepicker">
      <div className="facepicker-left">
        <div className="facepicker-head">
          <h2>{panel.model}</h2>
          <p>
            外形 {panel.outer.w} × {panel.outer.h} × D{panel.outer.d} ／ 中板 {panel.plate.w} ×{' '}
            {panel.plate.h}
          </p>
          <p className="note">
            制御盤を<b>展開した図</b>です。加工したい面を押すとレイアウト画面に移ります。
            中板だけが配線ダクトと DIN レールを扱い、他の面は直接取り付けと穴あけ・切り欠き加工の対象です。
          </p>
        </div>

        <svg className="unfold" viewBox={`${-fs} ${-fs} ${diagW + fs * 2} ${diagH + fs * 2}`}>
          {cells.map((c) => {
            const def = FACES.find((f) => f.id === c.id)!;
            const size = faceSize(panel, c.id);
            const { devs, cuts } = countsOf(c.id);
            const badge = [devs > 0 ? `機器 ${devs}` : '', cuts > 0 ? `加工 ${cuts}` : '']
              .filter(Boolean)
              .join(' / ');
            // 細い面でも文字がはみ出さないよう、セル幅に合わせて字を縮める
            const fit = (text: string, base: number) =>
              Math.min(base, ((c.w - fs * 0.6) / Math.max(1, text.length)) / 0.62);
            const fName = fit(def.label, fs);
            const fDim = fit(`${size.w} × ${size.h}`, fs * 0.8);
            const fBadge = fit(badge || ' ', fs * 0.8);
            return (
              <g
                key={c.id}
                className={`ufcell${c.id === 'plate' ? ' plate' : ''}`}
                onClick={() => openFace(c.id)}
              >
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={fs / 3} />
                <text
                  x={c.x + c.w / 2}
                  y={c.y + c.h / 2 - fs * 0.9}
                  fontSize={fName}
                  className="name"
                >
                  {def.label}
                </text>
                <text x={c.x + c.w / 2} y={c.y + c.h / 2 + fs * 0.3} fontSize={fDim} className="dim">
                  {size.w} × {size.h}
                </text>
                {badge && (
                  <text
                    x={c.x + c.w / 2}
                    y={c.y + c.h / 2 + fs * 1.6}
                    fontSize={fBadge}
                    className="badge"
                  >
                    {badge}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="bombox">
        <h2>BOM（盤全体）</h2>
        {bom.length === 0 ? (
          <p className="note">機器を選ぶとここに盤全体の部品表が出ます。</p>
        ) : (
          <>
            <table className="bom">
              <thead>
                <tr>
                  <th>型式</th>
                  <th>メーカー / 品名</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {bom.map((l, i) => (
                  <tr key={i} className={l.source === 'derived' ? 'derived' : undefined}>
                    <td>
                      <strong>{l.model}</strong>
                    </td>
                    <td>
                      <span>
                        {l.maker} / {l.name}
                      </span>
                    </td>
                    <td className="qty">
                      {l.qty}
                      <em>{l.unit}</em>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              グレーの行は<b>派生部品</b>（DINレール・ダクト・ネジ）。手作業で一番漏れるところを自動で足しています。
            </p>
          </>
        )}

        <p className="calc">盤内総発熱 = {heat.toFixed(1)} W</p>

        <h3>CSV 書き出し</h3>
        <div className="grid2">
          <label className="sel">
            <span>文字コード</span>
            <select
              value={profile.bom.encoding}
              onChange={(e) => setBom({ encoding: e.target.value as BomSettings['encoding'] })}
            >
              <option value="cp932">Shift-JIS (CP932)</option>
              <option value="utf8">UTF-8 (BOM付き)</option>
            </select>
          </label>
          <label className="sel">
            <span>区切り</span>
            <select
              value={profile.bom.delimiter}
              onChange={(e) => setBom({ delimiter: e.target.value as BomSettings['delimiter'] })}
            >
              <option value=",">カンマ</option>
              <option value={'\t'}>タブ</option>
              <option value=";">セミコロン</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={profile.bom.withHeader}
              onChange={(e) => setBom({ withHeader: e.target.checked })}
            />
            <span>見出し行を付ける</span>
          </label>
        </div>
        <div className="row-buttons">
          <button
            disabled={bom.length === 0}
            onClick={() =>
              downloadCsv(bomToCsv(bom, profile.bom), `${base}_bom.csv`, profile.bom.encoding)
            }
          >
            部品表 CSV
          </button>
          <button
            disabled={cutouts.length === 0}
            onClick={() =>
              downloadCsv(
                machiningToCsv(cutouts, profile.bom),
                `${base}_machining.csv`,
                profile.bom.encoding,
              )
            }
          >
            加工リスト CSV（全面）
          </button>
        </div>
      </div>
    </div>
  );
}
