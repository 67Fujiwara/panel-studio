import { DUCT_LAYOUT_HINT, DUCT_LAYOUT_LABEL, DUCT_LAYOUT_READY } from '../data/enclosures';
import { TAP_DRILL, TAP_SIZES } from '../lib/machining';
import { useStore } from '../store';
import type { DuctLayoutId, FixingSettings, RowHeightMode, TapSize } from '../types';

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

/** ダクト・DINレールの固定穴。中身が同じなので使い回す。 */
function FixingFields({
  value,
  onChange,
}: {
  value: FixingSettings;
  onChange: (patch: Partial<FixingSettings>) => void;
}) {
  return (
    <div className="grid4">
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
  );
}

/**
 * ダクトと DINレールの登録。
 *
 * どれも案件ごとに変えるものではなく「うちはこう作る」という決め事なので、
 * レイアウト画面ではなく設定画面に置く。
 * 案件ごとに変えたい段ごとの余白だけはレイアウト画面に残してある。
 */
export function DuctRailSettings() {
  const profile = useStore((s) => s.profile);
  const setDuct = useStore((s) => s.setDuct);
  const setRail = useStore((s) => s.setRail);

  const isEqual = profile.duct.rowHeightMode === 'equal';

  return (
    <>
      <h3 className="section">配線ダクト</h3>
      <div className="grid2">
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
      </div>
      <p className="note">{DUCT_LAYOUT_HINT[profile.duct.layout]}</p>

      <div className="grid4">
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

      <h4>ダクトの固定穴</h4>
      <p className="note">
        ダクト1本あたりの固定か所とタップです。穴の座標はレイアウト画面の<b>加工</b>に出ます。
        ピッチを 0 にすると、両端の余白を除いた残りを<b>等分</b>します。
      </p>
      <FixingFields
        value={profile.duct.fixing}
        onChange={(patch) => setDuct({ fixing: { ...profile.duct.fixing, ...patch } })}
      />

      <h3 className="section">DINレール</h3>
      <div className="grid4">
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
      <h4>DINレールの固定穴</h4>
      <FixingFields
        value={profile.rail.fixing}
        onChange={(patch) => setRail({ fixing: { ...profile.rail.fixing, ...patch } })}
      />
    </>
  );
}
