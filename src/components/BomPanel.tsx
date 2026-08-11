import { buildBom, totalHeatW } from '../lib/bom';
import { asciiFileName, bomToCsv, downloadCsv, machiningToCsv } from '../lib/csv';
import { derivedMachining } from '../lib/machining';
import { useStore } from '../store';
import type { BomSettings, LayoutResult } from '../types';

export function BomPanel({ layout }: { layout: LayoutResult }) {
  const panel = useStore((s) => s.panel);
  const face = useStore((s) => s.face);
  const profile = useStore((s) => s.profile);
  const setBom = useStore((s) => s.setBom);
  const resetLayout = useStore((s) => s.resetLayout);
  const manual = useStore((s) => s.machining);
  const pinnedCount = useStore((s) => s.pinned.filter((p) => p.face === s.face).length);

  const bom = buildBom(layout, profile);
  const heat = totalHeatW(layout);
  const cutouts = [...derivedMachining(layout.placed), ...manual.filter((m) => m.face === face)];

  const base = asciiFileName(panel.model, 'panel');

  return (
    <div className="panel">
      <h2>BOM</h2>
      {bom.length === 0 ? (
        <p className="note">機器を選ぶとここに部品表が出ます。</p>
      ) : (
        <table className="bom">
          <thead>
            <tr>
              <th>型式</th>
              <th>数量</th>
            </tr>
          </thead>
          <tbody>
            {bom.map((l, i) => (
              <tr key={i} className={l.source === 'derived' ? 'derived' : undefined}>
                <td>
                  <strong>{l.model}</strong>
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
      )}
      <p className="note">
        グレーの行は<b>派生部品</b>（DINレール・ダクト・ネジ）。手作業で一番漏れるところを自動で足しています。
      </p>

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
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={profile.bom.withHeader}
          onChange={(e) => setBom({ withHeader: e.target.checked })}
        />
        <span>見出し行を付ける</span>
      </label>
      <p className="note">
        国内 ERP は Shift-JIS 指定のことが多いので既定にしています。取込仕様が分かれば
        ここを変えるだけで合わせられます。
      </p>
      <div className="row-buttons">
        <button
          disabled={bom.length === 0}
          onClick={() => downloadCsv(bomToCsv(bom, profile.bom), `${base}_bom.csv`, profile.bom.encoding)}
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
          加工リスト CSV
        </button>
      </div>

      <h2>チェック</h2>
      <p className="calc">この面の発熱 = {heat.toFixed(1)} W</p>
      {layout.violations.length === 0 ? (
        <p className="ok">違反なし</p>
      ) : (
        <ul className="violations">
          {layout.violations.map((v, i) => (
            <li key={i}>{v.message}</li>
          ))}
        </ul>
      )}

      {pinnedCount > 0 && (
        <button className="reset" onClick={resetLayout}>
          この面の手動配置を解除して再配置（{pinnedCount}台）
        </button>
      )}
    </div>
  );
}
