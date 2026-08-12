import { useStore } from '../store';
import type { DuctSpec } from '../types';

function Cell({
  value,
  onChange,
  width = 68,
}: {
  value: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  return (
    <input
      type="number"
      className="encl-num"
      style={{ width }}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/**
 * ダクトマスタ。
 *
 * 幅を数値で都度入れる方式だと、実在しない寸法の組み合わせが図に出てしまう。
 * 部品と同じように型式で登録し、中板画面ではそこから選ぶだけにする。
 */
export function DuctTable() {
  const ducts = useStore((s) => s.ducts);
  const usingId = useStore((s) => s.profile.duct.ductId);
  const addDuct = useStore((s) => s.addDuct);
  const updateDuct = useStore((s) => s.updateDuct);
  const removeDuct = useStore((s) => s.removeDuct);
  const selectDuctSpec = useStore((s) => s.selectDuctSpec);

  const patch = (id: string, p: Partial<DuctSpec>) => updateDuct(id, p);

  return (
    <>
      <h3 className="section">ダクトマスタ（配線ダクトの型式）</h3>
      <p className="note">
        ここに登録した型式が、<b>中板画面の「使うダクト」</b>に出ます。
        幅は図の帯の太さ、高さは中板からの立ち上がり、定尺は必要本数の計算に使います。
      </p>
      <div className="row-buttons">
        <button onClick={addDuct}>＋ ダクトを追加</button>
      </div>

      <div className="tablewrap">
        <table className="encl">
          <thead>
            <tr>
              <th>型式</th>
              <th>メーカー</th>
              <th>幅</th>
              <th>高さ</th>
              <th>定尺</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {ducts.map((d) => (
              <tr key={d.id} className={d.id === usingId ? 'on' : undefined}>
                <td>
                  <input
                    type="text"
                    className="encl-model"
                    value={d.model}
                    onChange={(e) => patch(d.id, { model: e.target.value })}
                    aria-label="型式"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="encl-model"
                    value={d.maker}
                    onChange={(e) => patch(d.id, { maker: e.target.value })}
                    aria-label="メーカー"
                  />
                </td>
                <td>
                  <Cell value={d.width} onChange={(width) => patch(d.id, { width })} />
                </td>
                <td>
                  <Cell value={d.height} onChange={(height) => patch(d.id, { height })} />
                </td>
                <td>
                  <Cell value={d.stock} onChange={(stock) => patch(d.id, { stock })} width={80} />
                </td>
                <td>
                  {d.id === usingId ? (
                    <span className="using">使用中</span>
                  ) : (
                    <button onClick={() => selectDuctSpec(d.id)} title="このダクトを使う">
                      使う
                    </button>
                  )}
                </td>
                <td>
                  <button onClick={() => removeDuct(d.id)} aria-label="ダクトを削除">
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {ducts.length === 0 && (
              <tr>
                <td colSpan={7} className="note">
                  登録がありません。「＋ ダクトを追加」で登録してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
