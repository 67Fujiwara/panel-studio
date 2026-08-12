import { DUCT_LAYOUT_LABEL } from '../data/enclosures';
import { computeRows } from '../lib/layout';
import { useStore } from '../store';

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
export function SettingsPanel({ rowCount }: { rowCount: number }) {
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const setDuct = useStore((s) => s.setDuct);
  const setClearance = useStore((s) => s.setClearance);
  const setRowGap = useStore((s) => s.setRowGap);
  const go = useStore((s) => s.go);
  const rowGaps = profile.duct.rowGaps ?? {};

  const isEqual = profile.duct.rowHeightMode === 'equal';
  const rowH = computeRows(panel, face, profile).rows[0]?.h ?? 0;

  return (
    <div className="panel">
      {/*
        ダクトの引き方・幅・固定穴と DINレールは「うちはこう作る」という決め事なので
        設定画面で登録する。ここには案件ごとに動かすものだけを置く。
      */}
      <div className="applied">
        <h2>いまの決め事</h2>
        <ul>
          <li>
            <span>ダクト</span>
            <b>
              {DUCT_LAYOUT_LABEL[profile.duct.layout]} ／ 幅 {profile.duct.width}
            </b>
          </li>
          <li>
            <span>段の高さ</span>
            <b>
              {isEqual
                ? `全段そろえる（${profile.duct.rowCount}段・${rowH > 0 ? rowH.toFixed(0) : '—'}mm）`
                : '中身に合わせる'}
            </b>
          </li>
          <li>
            <span>固定穴</span>
            <b>
              ダクト {profile.duct.fixing.points}か所 {profile.duct.fixing.tap} ／ レール{' '}
              {profile.rail.fixing.points}か所 {profile.rail.fixing.tap}
            </b>
          </li>
          <li>
            <span>レール余長</span>
            <b>両端 {profile.rail.endMargin}mm</b>
          </li>
        </ul>
        <button onClick={() => go('config')}>設定画面で変更する →</button>
      </div>

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
