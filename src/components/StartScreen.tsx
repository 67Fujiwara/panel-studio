import { useState } from 'react';
import { SAMPLE_ENCLOSURES } from '../data/enclosures';
import { findRectangles, readDxfText, type RectCandidate } from '../lib/dxfImport';
import { useStore } from '../store';

function Num({
  label,
  value,
  onChange,
  step = 10,
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
 * 最初の画面。制御盤の寸法をここで確定させてからレイアウトへ進む。
 * 手で入れるか、DXF から拾うかを選べる。
 */
export function StartScreen() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const setOuter = useStore((s) => s.setOuter);
  const setPlate = useStore((s) => s.setPlate);
  const setDepth = useStore((s) => s.setDepth);
  const go = useStore((s) => s.go);

  const [tab, setTab] = useState<'manual' | 'dxf'>('manual');
  const [candidates, setCandidates] = useState<RectCandidate[]>([]);
  const [fileInfo, setFileInfo] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setCandidates([]);
    try {
      const text = await readDxfText(file);
      const { candidates, entityCount } = findRectangles(text);
      setCandidates(candidates.slice(0, 40));
      setFileInfo(`${file.name} — 図形 ${entityCount} 個から候補 ${candidates.length} 件`);
      if (candidates.length === 0) setError('矩形が見つかりませんでした。手入力に切り替えてください。');
    } catch (e) {
      setError(`読み込めませんでした: ${String(e)}`);
    }
  };

  return (
    <div className="start">
      <h2>制御盤のサイズ</h2>
      <p className="note">
        ここで決めた寸法から6面の作図寸法を導きます。あとから変更できます。
      </p>

      <div className="tabs">
        <button className={tab === 'manual' ? 'on' : ''} onClick={() => setTab('manual')}>
          手動入力
        </button>
        <button className={tab === 'dxf' ? 'on' : ''} onClick={() => setTab('dxf')}>
          DXF から取り込む
        </button>
      </div>

      {tab === 'manual' ? (
        <>
          <label className="sel">
            <span>型式（登録済みから選ぶ）</span>
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
          <label className="num">
            <span>型式名</span>
            <input
              type="text"
              value={panel.model}
              onChange={(e) => setPanel({ model: e.target.value })}
            />
          </label>
        </>
      ) : (
        <div className="dxfbox">
          <p className="note">
            日東工業などの DXF を読み込むと、図面に含まれる矩形を大きい順に並べます。
            <b>どれが外形でどれが中板かは選んでください。</b>
            三面図・寸法線・表題欄が同居しているので機械任せにはできません。
            一度選べば型式名と一緒に控えておけます。
          </p>
          <input
            type="file"
            accept=".dxf"
            onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
          />
          {fileInfo && <p className="calc">{fileInfo}</p>}
          {error && <p className="calc bad">{error}</p>}
          {candidates.length > 0 && (
            <table className="cands">
              <thead>
                <tr>
                  <th>寸法 (W×H)</th>
                  <th>レイヤ</th>
                  <th>拾い方</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.key}>
                    <td className="qty">
                      {c.w} × {c.h}
                    </td>
                    <td>{c.layer}</td>
                    <td>{c.from}</td>
                    <td className="cand-actions">
                      <button onClick={() => setOuter({ w: c.w, h: c.h })}>外形に</button>
                      <button onClick={() => setPlate({ w: c.w, h: c.h })}>中板に</button>
                      <button onClick={() => setOuter({ d: c.h })}>奥行きに</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <h3>外形</h3>
      <div className="grid3">
        <Num label="幅" value={panel.outer.w} onChange={(w) => setOuter({ w })} />
        <Num label="高さ" value={panel.outer.h} onChange={(h) => setOuter({ h })} />
        <Num label="奥行き" value={panel.outer.d} onChange={(d) => setOuter({ d })} step={5} />
      </div>

      <h3>中板</h3>
      <div className="grid3">
        <Num label="幅" value={panel.plate.w} onChange={(w) => setPlate({ w })} />
        <Num label="高さ" value={panel.plate.h} onChange={(h) => setPlate({ h })} />
      </div>

      <h3>奥行きの内訳</h3>
      <p className="note">
        メーカー図面の「背面→中板上面」は実物と合わないため<b>手入力</b>します。
      </p>
      <div className="grid3">
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
      <p className="calc">
        有効奥行き = {panel.outer.d - panel.depth.backToPlate - panel.depth.doorProjection} mm
      </p>

      <div className="row-buttons start-actions">
        <button className="primary" onClick={() => go('faces')}>
          この寸法で進む →
        </button>
        <button onClick={() => go('config')}>ConfigFile</button>
        <button onClick={() => go('myconfig')}>MyConfig</button>
      </div>
    </div>
  );
}
