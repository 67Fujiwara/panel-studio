import { buildBom, totalHeatW } from '../lib/bom';
import { useStore } from '../store';
import type { LayoutResult } from '../types';

export function BomPanel({ layout }: { layout: LayoutResult }) {
  const profile = useStore((s) => s.profile);
  const resetLayout = useStore((s) => s.resetLayout);
  const pinnedCount = useStore((s) => s.pinned.length);

  const bom = buildBom(layout, profile);
  const heat = totalHeatW(layout);

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

      <h2>チェック</h2>
      <p className="calc">盤内総発熱 = {heat.toFixed(1)} W</p>
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
          手動配置を解除して再配置（{pinnedCount}台）
        </button>
      )}
    </div>
  );
}
