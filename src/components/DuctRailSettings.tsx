import { TAP_DRILL, TAP_SIZES } from '../lib/machining';
import { useStore } from '../store';
import type { FixingSettings, TapSize } from '../types';

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

/** ダクト・DINレールの固定穴。中身が同じなので使い回す（ダクトマスタの個別設定でも使う）。 */
export function FixingFields({
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
        hint="端から刻み／0 で等分"
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
 * ダクトと DINレールの固定穴・余長の登録。
 *
 * 加工屋への指示の作法なので案件ごとには変えない。ここで登録しておく。
 * レイアウトの引き方・使うダクト・段の高さは案件ごとに選ぶものなので中板画面に置いてある。
 */
export function DuctRailSettings() {
  const profile = useStore((s) => s.profile);
  const setDuct = useStore((s) => s.setDuct);
  const setRail = useStore((s) => s.setRail);

  return (
    <>
      <h3 className="section">ダクトの固定穴</h3>
      <p className="note">
        ダクト1本あたりの固定か所とタップです。穴の座標はレイアウト画面の<b>加工</b>に出ます。
        ピッチがあるときは<b>片側の端（左端・縦ダクトは下端）を基準に、端からの距離＋ピッチ刻み</b>
        の位置だけを使い、固定か所ぶんを両端からできるだけ均等に選びます（製品の底穴と合わせるため）。
        ピッチを 0 にすると、両端の余白を除いた残りを<b>等分</b>します。DINレールも同じ考え方です。
        底の穴位置が型式で違うときは、<b>ダクトマスタの行の「固定穴」</b>で型式ごとに
        変えられます。ここの値は個別設定の無い型式に効きます。
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
