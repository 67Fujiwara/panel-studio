import { useMemo } from 'react';
import { FACES, faceSize } from '../data/faces';
import { buildBom, totalHeatW } from '../lib/bom';
import { asciiFileName, bomToCsv, downloadCsv, machiningToCsv } from '../lib/csv';
import { autoLayout } from '../lib/layout';
import { derivedMachining } from '../lib/machining';
import { deviceLookup, useStore } from '../store';
import type { BomSettings } from '../types';

/**
 * 面の選択画面。
 * 既存図面が三角法なので、それに合わせた並びでカードを置く。
 * BOM は面ごとではなく盤単位のものなので、6面ぶんをまとめてここに出す。
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
  const cutouts = [
    ...layouts.flatMap((l) => derivedMachining(l.placed, lookup)),
    ...machining,
  ];
  const base = asciiFileName(panel.model, 'panel');

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
          加工したい面を選ぶとレイアウト画面に移ります。並びは既存図面と同じ<b>三角法</b>です。
          中板だけが配線ダクトと DIN レールを扱い、他の面は直接取り付けと穴あけ・切り欠き加工の対象です。
        </p>
      </div>

      <div className="facegrid">
        {FACES.map((f, i) => {
          const size = faceSize(panel, f.id);
          const devs = items.filter((it) => it.face === f.id).length;
          const cuts =
            derivedMachining(layouts[i]!.placed, lookup).length +
            machining.filter((m) => m.face === f.id).length;
          return (
            <button
              key={f.id}
              className={`facecard${f.id === 'plate' ? ' plate' : ''}`}
              style={{ gridColumn: f.grid.col, gridRow: f.grid.row }}
              onClick={() => openFace(f.id)}
            >
              <strong>{f.label}</strong>
              <span className="dim">
                {size.w} × {size.h}
              </span>
              <span className="hint">{f.hint}</span>
              <span className="counts">
                {devs > 0 && <em>機器 {devs}</em>}
                {cuts > 0 && <em>加工 {cuts}</em>}
                {devs === 0 && cuts === 0 && <em className="empty">未設定</em>}
              </span>
            </button>
          );
        })}
      </div>
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
