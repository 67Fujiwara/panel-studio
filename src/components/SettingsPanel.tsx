import { DUCT_LAYOUT_HINT, DUCT_LAYOUT_LABEL, DUCT_LAYOUT_READY } from '../data/enclosures';
import { computeRows } from '../lib/layout';
import { TAP_DRILL, TAP_SIZES } from '../lib/machining';
import { useStore } from '../store';
import type { DuctLayoutId, FixingSettings, RowHeightMode, TapSize } from '../types';

/** ダクト・DINレールの固定穴の設定。中身が同じなので使い回す。 */
function FixingFields({
  value,
  onChange,
}: {
  value: FixingSettings;
  onChange: (patch: Partial<FixingSettings>) => void;
}) {
  return (
    <>
      <div className="grid2">
        <Num
          label="固定か所"
          hint="1本あたり"
          value={value.points}
          onChange={(points) => onChange({ points: Math.max(1, points) })}
        />
        <label className="sel">
          <span>タップ</span>
          <select value={value.tap} onChange={(e) => onChange({ tap: e.target.value as TapSize })}>
            {TAP_SIZES.map((t) => (
              <option key={t} value={t}>
                {t}（下穴 φ{TAP_DRILL[t]}）
              </option>
            ))}
          </select>
        </label>
        <Num
          label="穴ピッチ"
          hint="0 で等分"
          value={value.pitch}
          onChange={(pitch) => onChange({ pitch: Math.max(0, pitch) })}
          step={5}
        />
        <Num
          label="端からの距離"
          value={value.endOffset}
          onChange={(endOffset) => onChange({ endOffset: Math.max(0, endOffset) })}
          step={5}
        />
      </div>
    </>
  );
}

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

/** 中板の左ペイン。ダクトとクリアランスだけを扱う（盤サイズは最初の画面）。 */
export function SettingsPanel({ rowCount }: { rowCount: number }) {
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const setDuct = useStore((s) => s.setDuct);
  const setRail = useStore((s) => s.setRail);
  const setClearance = useStore((s) => s.setClearance);
  const setRowGap = useStore((s) => s.setRowGap);
  const rowGaps = profile.duct.rowGaps ?? {};

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
      <div className="grid2">
        <Num
          label="ダクト幅"
          value={profile.duct.width}
          onChange={(width) => setDuct({ width })}
          step={10}
        />
        {isEqual && (
          <Num
            label="機器行の数"
            value={profile.duct.rowCount}
            onChange={(rowCount) => setDuct({ rowCount })}
          />
        )}
      </div>
      {isEqual ? (
        <p className={`calc${rowH <= 0 ? ' bad' : ''}`}>
          機器行の高さ = {rowH > 0 ? rowH.toFixed(1) : '—'} mm
        </p>
      ) : (
        <p className="note">
          段に入った機器の背丈から段ごとに高さを決めます。段数は自動で決まるので指定不要です。
        </p>
      )}

      {rowCount > 0 && (
        <>
          <h3>段ごとの余白</h3>
          <p className="note">
            段ごとに余白を変えられます。<b>上下</b>はダクトとの余白、<b>左右</b>は中板の端からの余白です。
            指定しない段は、上下が下の「機器 ⇔ ダクト」、左右が「中板の端からの余白」を使います。
            ダクトの長さも指定した左右に合わせます。
          </p>
          {Array.from({ length: rowCount }, (_, i) => {
            const g = rowGaps[i];
            return (
              <div key={i} className="rowgap">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(g)}
                    onChange={(e) =>
                      setRowGap(
                        i,
                        e.target.checked
                          ? {
                              top: profile.clearance.deviceToDuct.top,
                              bottom: profile.clearance.deviceToDuct.bottom,
                              left: profile.duct.margin.left,
                              right: profile.duct.margin.right,
                            }
                          : undefined,
                      )
                    }
                  />
                  <span>{i + 1} 段目を個別に決める</span>
                </label>
                {g && (
                  <div className="grid2">
                    <Num label="上" value={g.top} onChange={(top) => setRowGap(i, { ...g, top })} />
                    <Num
                      label="下"
                      value={g.bottom}
                      onChange={(bottom) => setRowGap(i, { ...g, bottom })}
                    />
                    <Num
                      label="左"
                      value={g.left ?? profile.duct.margin.left}
                      onChange={(left) => setRowGap(i, { ...g, left })}
                    />
                    <Num
                      label="右"
                      value={g.right ?? profile.duct.margin.right}
                      onChange={(right) => setRowGap(i, { ...g, right })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      <h3>ダクトの固定穴</h3>
      <p className="note">
        ダクト1本あたりの固定か所とタップです。穴の座標は右の<b>加工</b>に出ます。
        ピッチを 0 にすると、両端の余白を除いた残りを<b>等分</b>します。
      </p>
      <FixingFields
        value={profile.duct.fixing}
        onChange={(patch) => setDuct({ fixing: { ...profile.duct.fixing, ...patch } })}
      />

      <h2>DINレール</h2>
      <div className="grid2">
        <Num
          label="両端の余長"
          hint="エンドストッパ分"
          value={profile.rail.endMargin}
          onChange={(endMargin) => setRail({ endMargin })}
          step={5}
        />
      </div>
      <p className="note">
        機器の端からレール端までの伸ばし量です。切断長と BOM もこの値で決まります。
      </p>
      <h3>DINレールの固定穴</h3>
      <FixingFields
        value={profile.rail.fixing}
        onChange={(patch) => setRail({ fixing: { ...profile.rail.fixing, ...patch } })}
      />

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
