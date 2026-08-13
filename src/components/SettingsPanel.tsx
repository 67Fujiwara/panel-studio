import { DUCT_LAYOUT_HINT, DUCT_LAYOUT_LABEL, DUCT_LAYOUT_READY } from '../data/enclosures';
import { computeRows } from '../lib/layout';
import { useStore } from '../store';
import type { DuctLayoutId, RowHeightMode } from '../types';

function Num({
  label,
  value,
  onChange,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="num">
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * 中板の左ペイン。案件ごとに動かす余白とクリアランスだけを扱う。
 * ダクトの引き方・幅・固定穴と DINレールは設定画面（盤マスタと同じ場所）で登録する。
 */
export function SettingsPanel({ ductCount }: { ductCount: number }) {
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const setDuct = useStore((s) => s.setDuct);
  const setClearance = useStore((s) => s.setClearance);
  const setDuctGap = useStore((s) => s.setDuctGap);
  const ducts = useStore((s) => s.ducts);
  const selectDuctSpec = useStore((s) => s.selectDuctSpec);
  const ductGaps = profile.duct.ductGaps ?? {};

  const isEqual = profile.duct.rowHeightMode === 'equal';
  const rowH = computeRows(panel, face, profile).rows[0]?.h ?? 0;

  return (
    <div className="panel">
      <h2>ダクト</h2>
      <label className="sel">
        <span>レイアウト</span>
        <select
          value={profile.duct.layout}
          onChange={(e) => setDuct({ layout: e.target.value as DuctLayoutId })}
        >
          {(Object.keys(DUCT_LAYOUT_LABEL) as DuctLayoutId[]).map((id) => (
            <option key={id} value={id} disabled={!DUCT_LAYOUT_READY[id]}>
              {DUCT_LAYOUT_LABEL[id]}
              {DUCT_LAYOUT_READY[id] ? '' : '（準備中）'}
            </option>
          ))}
        </select>
      </label>
      <p className="note">{DUCT_LAYOUT_HINT[profile.duct.layout]}</p>

      {/* 幅は数値で打たず、設定画面に登録した型式から選ぶ */}
      <label className="sel">
        <span>使うダクト</span>
        <select value={profile.duct.ductId} onChange={(e) => selectDuctSpec(e.target.value)}>
          {ducts.length === 0 && <option value="">（登録なし — 幅 {profile.duct.width}）</option>}
          {!ducts.some((d) => d.id === profile.duct.ductId) && ducts.length > 0 && (
            <option value={profile.duct.ductId}>（未登録 — 幅 {profile.duct.width}）</option>
          )}
          {ducts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.model}（幅 {d.width} / 高さ {d.height}）
            </option>
          ))}
        </select>
      </label>
      <p className="note">
        型式の登録は<b>設定</b>画面の「ダクトマスタ」で行います。
      </p>

      <label className="sel">
        <span>段の高さ</span>
        <select
          value={profile.duct.rowHeightMode}
          onChange={(e) => setDuct({ rowHeightMode: e.target.value as RowHeightMode })}
        >
          <option value="auto">中身に合わせる（段ごとに可変）</option>
          <option value="equal">全段そろえる（段数を指定）</option>
        </select>
      </label>
      {isEqual && (
        <div className="grid2">
          <Num
            label="機器行の数"
            value={profile.duct.rowCount}
            onChange={(rowCount) => setDuct({ rowCount })}
          />
        </div>
      )}
      {isEqual ? (
        <p className={`calc${rowH <= 0 ? ' bad' : ''}`}>
          機器行の高さ = {rowH > 0 ? rowH.toFixed(1) : '—'} mm
        </p>
      ) : (
        <p className="note">
          段に入った機器の背丈から段ごとに高さを決めます。段数は自動で決まるので指定不要です。
        </p>
      )}

      {ductCount > 0 && (
        <>
          <h3>ダクトごとの調整（{ductCount} 本）</h3>
          {Array.from({ length: ductCount }, (_, i) => {
            const g = ductGaps[i];
            const first = i === 0;
            const last = i === ductCount - 1;
            return (
              <div key={i} className="rowgap">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(g)}
                    onChange={(e) =>
                      setDuctGap(
                        i,
                        e.target.checked
                          ? {
                              above: profile.clearance.deviceToDuct.bottom,
                              below: profile.clearance.deviceToDuct.top,
                              left: profile.duct.margin.left,
                              right: profile.duct.margin.right,
                            }
                          : undefined,
                      )
                    }
                  />
                  <span>ダクト {i + 1} 本目を個別に決める</span>
                </label>
                {g && (
                  <div className="grid2">
                    {/* いちばん上のダクトの上、いちばん下のダクトの下には機器が無い */}
                    {!first && (
                      <Num
                        label="上の余白"
                        value={g.above ?? profile.clearance.deviceToDuct.bottom}
                        onChange={(above) => setDuctGap(i, { ...g, above })}
                      />
                    )}
                    {!last && (
                      <Num
                        label="下の余白"
                        value={g.below ?? profile.clearance.deviceToDuct.top}
                        onChange={(below) => setDuctGap(i, { ...g, below })}
                      />
                    )}
                    <Num
                      label="左"
                      value={g.left ?? profile.duct.margin.left}
                      onChange={(left) => setDuctGap(i, { ...g, left })}
                    />
                    <Num
                      label="右"
                      value={g.right ?? profile.duct.margin.right}
                      onChange={(right) => setDuctGap(i, { ...g, right })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      <h2>余白とクリアランス</h2>
      <h3>中板の端からの余白</h3>
      <div className="grid2">
        <Num
          label="上"
          value={profile.duct.margin.top}
          onChange={(top) => setDuct({ margin: { ...profile.duct.margin, top } })}
        />
        <Num
          label="下"
          value={profile.duct.margin.bottom}
          onChange={(bottom) => setDuct({ margin: { ...profile.duct.margin, bottom } })}
        />
        <Num
          label="左"
          value={profile.duct.margin.left}
          onChange={(left) => setDuct({ margin: { ...profile.duct.margin, left } })}
        />
        <Num
          label="右"
          value={profile.duct.margin.right}
          onChange={(right) => setDuct({ margin: { ...profile.duct.margin, right } })}
        />
      </div>

      <h2>クリアランス</h2>
      <p className="note">
        実効値は <b>max(ここの設定, 機器ごとのメーカー指定値)</b>。メーカー指定を下回りません。
        機器は段の中で<b>上下中央</b>に置きます（DIN取付・直接取付とも）。
      </p>
      <h3>機器 ⇔ ダクト</h3>
      <div className="grid2">
        <Num
          label="上"
          value={profile.clearance.deviceToDuct.top}
          onChange={(top) => setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, top } })}
        />
        <Num
          label="下"
          value={profile.clearance.deviceToDuct.bottom}
          onChange={(bottom) =>
            setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, bottom } })
          }
        />
      </div>
      <h3>その他</h3>
      <div className="grid2">
        <Num
          label="機器⇔機器(同一行)"
          value={profile.clearance.deviceToDevice.sameRow}
          onChange={(sameRow) =>
            setClearance({ deviceToDevice: { ...profile.clearance.deviceToDevice, sameRow } })
          }
        />
        <Num
          label="機器⇔中板の端"
          value={profile.clearance.deviceToPlateEdge}
          onChange={(deviceToPlateEdge) => setClearance({ deviceToPlateEdge })}
        />
        <Num
          label="発熱機器の追加離隔"
          hint="10W以上"
          value={profile.clearance.heatExtra}
          onChange={(heatExtra) => setClearance({ heatExtra })}
        />
      </div>
    </div>
  );
}
