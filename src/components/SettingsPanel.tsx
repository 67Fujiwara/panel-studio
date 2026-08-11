import { DUCT_LAYOUT_LABEL, SAMPLE_ENCLOSURES } from '../data/enclosures';
import { useStore } from '../store';
import { computeRows, effectiveDepth } from '../lib/layout';
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

function Txt({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SettingsPanel() {
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const setPanel = useStore((s) => s.setPanel);
  const setPlate = useStore((s) => s.setPlate);
  const setDepth = useStore((s) => s.setDepth);
  const setDuct = useStore((s) => s.setDuct);
  const setClearance = useStore((s) => s.setClearance);
  const setLayer = useStore((s) => s.setLayer);
  const setTextHeight = useStore((s) => s.setTextHeight);
  const layers = profile.drawing.layers;

  const depth = effectiveDepth(panel);
  const isEqual = profile.duct.rowHeightMode === 'equal';
  const rowH = computeRows(panel, profile.duct).rows[0]?.h ?? 0;

  return (
    <div className="panel">
      <h2>盤</h2>
      <label className="sel">
        <span>型式</span>
        <select
          value={panel.model}
          onChange={(e) => {
            const found = SAMPLE_ENCLOSURES.find((p) => p.model === e.target.value);
            if (found) setPanel(found);
          }}
        >
          {SAMPLE_ENCLOSURES.map((p) => (
            <option key={p.model}>{p.model}</option>
          ))}
        </select>
      </label>
      <div className="grid2">
        <Num label="中板 幅" value={panel.plate.w} onChange={(w) => setPlate({ w })} step={10} />
        <Num label="中板 高さ" value={panel.plate.h} onChange={(h) => setPlate({ h })} step={10} />
      </div>

      <h3>奥行き</h3>
      <p className="note">
        メーカー図面の「背面→中板上面」は実物と合わないため手入力します。干渉判定に効くのは
        <b>中板上面から扉内面までの有効奥行き</b>です。
      </p>
      <div className="grid2">
        <Num label="盤外形 奥行き" value={panel.depth.outer} onChange={(outer) => setDepth({ outer })} step={5} />
        <Num
          label="背面→中板上面"
          hint="手入力"
          value={panel.depth.backToPlate}
          onChange={(backToPlate) => setDepth({ backToPlate })}
          step={5}
        />
        <Num
          label="扉裏の突出"
          value={panel.depth.doorProjection}
          onChange={(doorProjection) => setDepth({ doorProjection })}
          step={5}
        />
      </div>
      <p className={`calc${depth <= 0 ? ' bad' : ''}`}>有効奥行き = {depth} mm</p>

      <h2>ダクト</h2>
      <label className="sel">
        <span>レイアウト</span>
        <select
          value={profile.duct.layout}
          onChange={(e) => setDuct({ layout: e.target.value as DuctLayoutId })}
        >
          {(Object.keys(DUCT_LAYOUT_LABEL) as DuctLayoutId[]).map((id) => (
            <option key={id} value={id} disabled={id !== 'horizontal-rows'}>
              {DUCT_LAYOUT_LABEL[id]}
              {id !== 'horizontal-rows' ? '（Phase 1で対応）' : ''}
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
      <div className="grid2">
        <Num label="ダクト幅" value={profile.duct.width} onChange={(width) => setDuct({ width })} step={10} />
        {isEqual && (
          <Num
            label="機器行の数"
            value={profile.duct.rowCount}
            onChange={(rowCount) => setDuct({ rowCount })}
          />
        )}
      </div>
      {isEqual ? (
        <>
          <p className={`calc${rowH <= 0 ? ' bad' : ''}`}>
            機器行の高さ = {rowH > 0 ? rowH.toFixed(1) : '—'} mm
          </p>
          <p className="note">
            全段を同じ高さで割り付けます。背の高い機器が入らない場合は段数を減らしてください。
          </p>
        </>
      ) : (
        <p className="note">
          段に入った機器の背丈から段ごとに高さを決めます。段数は自動で決まるので指定不要です。
          実際の盤に近いのはこちらです。
        </p>
      )}
      <h3>中板端からの余白</h3>
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
      </p>
      <h3>機器 ⇔ ダクト</h3>
      <div className="grid2">
        <Num
          label="上"
          value={profile.clearance.deviceToDuct.top}
          onChange={(top) =>
            setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, top } })
          }
        />
        <Num
          label="下"
          value={profile.clearance.deviceToDuct.bottom}
          onChange={(bottom) =>
            setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, bottom } })
          }
        />
        <Num
          label="左"
          value={profile.clearance.deviceToDuct.left}
          onChange={(left) =>
            setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, left } })
          }
        />
        <Num
          label="右"
          value={profile.clearance.deviceToDuct.right}
          onChange={(right) =>
            setClearance({ deviceToDuct: { ...profile.clearance.deviceToDuct, right } })
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
          label="機器⇔中板端"
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

      <h2>DXF 出力</h2>
      <p className="note">
        設計時のモデル空間が 1:1 なので、<b>実寸 mm をそのまま出力</b>します（縮尺は PDF 化のときに掛ける運用）。
        レイヤ名は既存図面の規則に合わせて変更してください。
      </p>
      <div className="grid2">
        <Txt label="中板" value={layers.plate} onChange={(v) => setLayer('plate', v)} />
        <Txt label="ダクト" value={layers.duct} onChange={(v) => setLayer('duct', v)} />
        <Txt label="機器" value={layers.device} onChange={(v) => setLayer('device', v)} />
        <Txt label="機器名" value={layers.text} onChange={(v) => setLayer('text', v)} />
        <Txt label="DINレール" value={layers.rail} onChange={(v) => setLayer('rail', v)} />
        <Num
          label="文字高さ"
          value={profile.drawing.textHeight}
          onChange={setTextHeight}
          step={0.5}
        />
      </div>
    </div>
  );
}
