import { useMemo, useState } from 'react';
import { FACES, faceSize } from '../data/faces';
import { buildBom, totalHeatW } from '../lib/bom';
import { asciiFileName, bomToCsv, downloadCsv, machiningToCsv } from '../lib/csv';
import { autoLayout, computeRails } from '../lib/layout';
import type { DeviceLookup } from '../lib/layout';
import { DIN_RAIL_WIDTH } from '../data/enclosures';
import { buildDxfSet, downloadDxfSet } from '../lib/dxfExport';
import { autoMachining, derivedMachining } from '../lib/machining';
import { ShapeGeometry } from './ShapeGeometry';
import { deviceLookup, useStore } from '../store';
import { rotatedSize } from '../types';
import type {
  BomSettings,
  CategoryDef,
  DeviceShape,
  FaceId,
  LayoutResult,
  PanelSpec,
} from '../types';

/** 面と面のすき間(mm 相当) */
const GAP = 40;

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
  const yPlate = yBottom + D + GAP * 1.6;

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
 * 面の中身の絵。
 *
 * 四角の枠だけではどの面がどれか分からないので、扉ならハンドル、背面なら取付足、
 * というように**その面らしい形**を描く。メーカー図面の三面図と同じ見え方にして、
 * 図面を見慣れた人がそのまま読めるようにする。
 *
 * DXF を取り込んである面は、絵ではなく**取り込んだ図そのもの**を描く。
 */
function FaceArt({
  id,
  x,
  y,
  w,
  h,
  depth,
  underlay,
}: {
  id: FaceId;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  underlay?: DeviceShape;
}) {
  if (underlay) {
    // 取り込んだ図は左下原点・Y上向きなので、Y を反転して重ねる
    return (
      <g
        className="ufart from-dxf"
        transform={`translate(${x} ${y + h}) scale(${w / (underlay.w || 1)} ${-h / (underlay.h || 1)})`}
      >
        <ShapeGeometry shape={underlay} color="currentColor" />
      </g>
    );
  }

  // 板金の折り返し。細い面はその幅に合わせて内側に寄せる
  const inset = Math.max(4, Math.min(w, h) * 0.045);
  const frame = <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} />;
  const foot = Math.min(w, h) * 0.09;
  const corners = (r: number, square: boolean) =>
    [
      [x + inset * 2.2, y + inset * 2.2],
      [x + w - inset * 2.2, y + inset * 2.2],
      [x + inset * 2.2, y + h - inset * 2.2],
      [x + w - inset * 2.2, y + h - inset * 2.2],
    ].map(([cx, cy], i) =>
      square ? (
        <rect key={i} x={cx! - r} y={cy! - r} width={r * 2} height={r * 2} />
      ) : (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ),
    );

  // 側面・上下面には扉が厚みの線として見える。実寸(mm)でそのまま引く
  const doorEdge = Math.max(6, Math.min(12, depth * 0.03));

  switch (id) {
    case 'door':
      return (
        <g className="ufart">
          {frame}
          {corners(inset * 0.7, false)}
          {/* ハンドル。扉だと一目で分かる目印 */}
          <rect
            x={x + inset * 2.4}
            y={y + h / 2 - h * 0.06}
            width={Math.max(6, w * 0.045)}
            height={h * 0.12}
            rx={2}
            className="handle"
          />
        </g>
      );
    case 'back':
      return (
        <g className="ufart">
          {frame}
          {/* 取付足 */}
          {corners(foot / 2, true)}
        </g>
      );
    case 'left':
    case 'right':
      return (
        <g className="ufart">
          {frame}
          {/* 手前が扉。左側面なら左端、右側面なら右端に見える */}
          <line
            x1={id === 'left' ? x + doorEdge : x + w - doorEdge}
            y1={y}
            x2={id === 'left' ? x + doorEdge : x + w - doorEdge}
            y2={y + h}
          />
        </g>
      );
    case 'top':
    case 'bottom':
      return (
        <g className="ufart">
          {frame}
          {/* 手前が扉。上面図では下端、底面図では上端に見える */}
          <line
            x1={x}
            y1={id === 'top' ? y + h - doorEdge : y + doorEdge}
            x2={x + w}
            y2={id === 'top' ? y + h - doorEdge : y + doorEdge}
          />
        </g>
      );
    case 'plate':
      return <g className="ufart">{corners(inset * 0.6, false)}</g>;
  }
}

/**
 * 面に配置した中身（ダクト・DINレール・機器）を、展開図のセルの中に実寸で描く。
 *
 * 「機器 12」のような数だけでは、どの面がもう埋まっていて、どこが空いているかが
 * 分からない。盤ぜんたいの絵として見えていないと、面を1つずつ開いて確かめる羽目になる。
 * ここでは形と量が伝わればよいので、文字は入れない（この縮尺では潰れて読めない）。
 */
function FaceContents({
  cell,
  size,
  layout,
  devices,
  categories,
  railMargin,
}: {
  cell: Cell;
  size: { w: number; h: number };
  layout: LayoutResult;
  devices: DeviceLookup;
  categories: CategoryDef[];
  railMargin: number;
}) {
  if (size.w <= 0 || size.h <= 0) return null;
  const rails = computeRails(layout, devices, railMargin);
  if (layout.placed.length === 0 && layout.ducts.length === 0) return null;

  const colorOf = (cat: string) => categories.find((c) => c.id === cat)?.color ?? '#7d8894';
  // 面の座標（左下原点・Y上向き）をセルの中へ。Y を反転して重ねる
  const transform = `translate(${cell.x} ${cell.y + cell.h}) scale(${cell.w / size.w} ${-cell.h / size.h})`;

  return (
    <g className="ufbody" transform={transform}>
      {layout.ducts
        .filter((d) => !d.removed)
        .map((d) => (
          <rect key={`d${d.id}`} className="ufduct" x={d.x} y={d.y} width={d.w} height={d.h} />
        ))}
      {rails.map((r) => (
        <rect
          key={`r${r.row}`}
          className="ufrail"
          x={r.x}
          y={r.y - DIN_RAIL_WIDTH / 2}
          width={r.length}
          height={DIN_RAIL_WIDTH}
        />
      ))}
      {layout.placed.map((p) => {
        const spec = devices.get(p.specId);
        if (!spec) return null;
        const s = rotatedSize(spec.size, p.rot);
        return (
          <rect
            key={p.uid}
            className="ufdev"
            x={p.x}
            y={p.y}
            width={s.w}
            height={s.h}
            // セルの塗り（.ufcell rect）に負けないよう、分類の色は style で当てる。
            // fill 属性は presentation attribute なので CSS に上書きされてしまう
            style={{ fill: colorOf(spec.category) }}
          />
        );
      })}
    </g>
  );
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
  const categories = useStore((s) => s.categories);
  const myDevices = useStore((s) => s.myDevices);
  const openFace = useStore((s) => s.openFace);
  const setBom = useStore((s) => s.setBom);
  const underlays = useStore((s) => s.underlays);
  const removedDucts = useStore((s) => s.removedDucts);
  const completeDesign = useStore((s) => s.completeDesign);
  const owners = useStore((s) => s.owners);
  const ducts = useStore((s) => s.ducts);
  // ストアの参照をそのまま取る。ここで map すると毎回新しい配列になり再描画が止まらなくなる
  const projects = useStore((s) => s.projects);

  // 担当者は My部品の担当者と、完了案件で使った名前の両方から選べるようにする
  const ownerChoices = useMemo(
    () => [...new Set([...owners, ...projects.map((p) => p.owner)].filter(Boolean))].sort(),
    [owners, projects],
  );
  const companyChoices = useMemo(
    () => [...new Set(projects.map((p) => p.company).filter(Boolean))].sort(),
    [projects],
  );
  const [jobCompany, setJobCompany] = useState('');
  const [jobNo, setJobNo] = useState('');
  const [jobDate, setJobDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [jobOwner, setJobOwner] = useState('');
  const [jobNote, setJobNote] = useState('');
  const [withDxf, setWithDxf] = useState(true);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);

  const layouts = useMemo(
    () =>
      FACES.map((f) =>
        autoLayout(panel, profile, f.id, items, pinned, lookup, removedDucts[f.id] ?? []),
      ),
    [panel, profile, items, pinned, lookup, removedDucts],
  );

  const bom = buildBom(layouts, profile, lookup, ducts);
  const heat = totalHeatW(layouts, lookup);
  const cutouts = [
    ...layouts.flatMap((l, i) => autoMachining(FACES[i]!.id, l, lookup, profile)),
    ...machining,
  ];
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
          <h2>{panel.model || '型式未設定'}</h2>
          <p>
            外形 {panel.outer.w} × {panel.outer.h} × D{panel.outer.d} ／ 中板 {panel.plate.w} ×{' '}
            {panel.plate.h}
          </p>
          <p className="note">
            メーカー図面と同じ<b>三面図の並び</b>です。加工したい面を押すとレイアウト画面に移ります。
            DXF を取り込んだ面は<b>取り込んだ図そのもの</b>を、無い面は扉のハンドル・背面の取付足といった
            <b>その面らしい形</b>を描いています。
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
            const cx = c.x + c.w / 2;
            return (
              <g
                key={c.id}
                className={`ufcell${c.id === 'plate' ? ' plate' : ''}`}
                onClick={() => openFace(c.id)}
              >
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={fs / 3} />
                <FaceArt
                  id={c.id}
                  x={c.x}
                  y={c.y}
                  w={c.w}
                  h={c.h}
                  depth={panel.outer.d}
                  underlay={underlays[c.id]}
                />
                {/* 配置した中身。面らしい形の上に重ねる */}
                <FaceContents
                  cell={c}
                  size={size}
                  layout={layouts[FACES.findIndex((f) => f.id === c.id)]!}
                  devices={lookup}
                  categories={categories}
                  railMargin={profile.rail.endMargin}
                />
                {/* 見出しは絵に重なるので、帯は敷かず文字自身を縁取って読ませる（CSS） */}
                <text x={cx} y={c.y + fs * 1.1} fontSize={fName} className="name">
                  {def.label}
                </text>
                <text x={cx} y={c.y + fs * 2.2} fontSize={fDim} className="dim">
                  {size.w} × {size.h}
                </text>
                {badge && (
                  <text x={cx} y={c.y + c.h - fs * 0.5} fontSize={fBadge} className="badge">
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

        <h3>CSV の書式</h3>
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
        <h3>設計完了</h3>
        <p className="note">
          この設計を<b>完了案件として残します</b>。あとから振り返ったり、
          <b>複製</b>で同じ内容を読み込んで似た盤を作れます。
        </p>
        <div className="grid2">
          <label className="num">
            <span>会社名</span>
            <input
              type="text"
              list="ps-companies"
              value={jobCompany}
              placeholder="納入先"
              onChange={(e) => setJobCompany(e.target.value)}
            />
            <datalist id="ps-companies">
              {companyChoices.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="num">
            <span>案件番号</span>
            <input
              type="text"
              value={jobNo}
              placeholder="例 2026-013"
              onChange={(e) => setJobNo(e.target.value)}
            />
          </label>
          <label className="num">
            <span>日付</span>
            <input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
          </label>
          <label className="num">
            <span>担当者</span>
            <input
              type="text"
              list="ps-owners"
              value={jobOwner}
              placeholder="氏名"
              onChange={(e) => setJobOwner(e.target.value)}
            />
            <datalist id="ps-owners">
              {ownerChoices.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="num">
          <span>メモ</span>
          <input
            type="text"
            value={jobNote}
            placeholder="特記事項など"
            onChange={(e) => setJobNote(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={withDxf}
            onChange={(e) => setWithDxf(e.target.checked)}
          />
          <span>
            設計完了と同時に <b>DXF 4ファイルを ZIP で書き出す</b>
            （キャビネット／中板 × 機器つき／加工穴のみ）
          </span>
        </label>
        <div className="row-buttons">
          <button
            className="primary"
            disabled={!jobOwner.trim()}
            title={jobOwner.trim() ? undefined : '担当者を入れてください'}
            onClick={() => {
              if (withDxf) {
                const base = asciiFileName(jobNo || panel.model, 'panel');
                downloadDxfSet(
                  buildDxfSet(
                    { panel, profile, items, pinned, machining, removedDucts, underlays, devices: lookup },
                    base,
                  ),
                  base,
                );
              }
              completeDesign({
                company: jobCompany,
                jobNo,
                owner: jobOwner,
                completedAt: jobDate,
                note: jobNote,
              });
              setJobNo('');
              setJobNote('');
            }}
          >
            ✓ 設計完了
          </button>
        </div>

        <h3>CSV 書き出し</h3>
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
