import { useState } from 'react';
import { FixingFields } from './DuctRailSettings';
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
 *
 * 固定穴は共通設定（ダクトの固定穴）が既定で、底の穴位置が型式で違うときだけ
 * 行の「固定穴」から型式ごとの設定に切り替える。個別にした型式は「個別」と出る。
 */
export function DuctTable() {
  const ducts = useStore((s) => s.ducts);
  const usingId = useStore((s) => s.profile.duct.ductId);
  const globalFix = useStore((s) => s.profile.duct.fixing);
  const addDuct = useStore((s) => s.addDuct);
  const updateDuct = useStore((s) => s.updateDuct);
  const removeDuct = useStore((s) => s.removeDuct);
  const selectDuctSpec = useStore((s) => s.selectDuctSpec);

  /** 固定穴の個別設定を開いている行。同時に1つだけ */
  const [openFix, setOpenFix] = useState<string | null>(null);

  const patch = (id: string, p: Partial<DuctSpec>) => updateDuct(id, p);

  return (
    <>
      <h3 className="section">ダクトマスタ（配線ダクトの型式）</h3>
      <p className="note">
        ここに登録した型式が、<b>中板画面の「使うダクト」</b>に出ます。
        幅は図の帯の太さ、高さは中板からの立ち上がり、定尺は必要本数の計算に使います。
        固定穴は共通の「ダクトの固定穴」が既定で、<b>「固定穴」から型式ごとにも変えられます</b>。
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
              <th>固定穴</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {ducts.map((d) => (
              <FragmentRow
                key={d.id}
                d={d}
                usingId={usingId}
                open={openFix === d.id}
                onToggleFix={() => {
                  if (!d.fixing) {
                    // 個別にした瞬間の値は共通設定の写し。ゼロから打たせない
                    patch(d.id, { fixing: { ...globalFix } });
                    setOpenFix(d.id);
                  } else {
                    setOpenFix(openFix === d.id ? null : d.id);
                  }
                }}
                onResetFix={() => {
                  patch(d.id, { fixing: undefined });
                  setOpenFix(null);
                }}
                patch={patch}
                selectDuctSpec={selectDuctSpec}
                removeDuct={removeDuct}
              />
            ))}
            {ducts.length === 0 && (
              <tr>
                <td colSpan={8} className="note">
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

/** 1型式ぶんの行。固定穴を個別にした型式は、下に設定の行を広げる。 */
function FragmentRow({
  d,
  usingId,
  open,
  onToggleFix,
  onResetFix,
  patch,
  selectDuctSpec,
  removeDuct,
}: {
  d: DuctSpec;
  usingId: string;
  open: boolean;
  onToggleFix: () => void;
  onResetFix: () => void;
  patch: (id: string, p: Partial<DuctSpec>) => void;
  selectDuctSpec: (id: string) => void;
  removeDuct: (id: string) => void;
}) {
  return (
    <>
      <tr className={d.id === usingId ? 'on' : undefined}>
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
          <button
            className={d.fixing ? 'on' : undefined}
            onClick={onToggleFix}
            title={
              d.fixing
                ? 'この型式だけの固定穴の設定です。押すと開閉します'
                : '共通の「ダクトの固定穴」を使っています。押すとこの型式だけの設定にします'
            }
          >
            {d.fixing ? '個別' : '共通'}
          </button>
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
      {d.fixing && open && (
        <tr className="fixrow">
          <td colSpan={8}>
            <div className="fixrow-body">
              <FixingFields
                value={d.fixing}
                onChange={(p) => patch(d.id, { fixing: { ...d.fixing!, ...p } })}
              />
              <button onClick={onResetFix} title="個別の設定を消して、共通の「ダクトの固定穴」に戻します">
                共通に戻す
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
