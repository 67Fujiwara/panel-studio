import { useState } from 'react';
import { SAMPLE_ENCLOSURES } from '../data/enclosures';
import { FACES } from '../data/faces';
import {
  extractRegion,
  findRectangles,
  readDxfText,
  type Prim,
  type RectCandidate,
} from '../lib/dxfImport';
import { useStore } from '../store';
import type { FaceId } from '../types';

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

  const setUnderlay = useStore((s) => s.setUnderlay);
  const underlays = useStore((s) => s.underlays);

  const [tab, setTab] = useState<'manual' | 'dxf'>('manual');
  const [candidates, setCandidates] = useState<RectCandidate[]>([]);
  const [prims, setPrims] = useState<Prim[]>([]);
  const [target, setTarget] = useState<FaceId>('plate');
  const [fileInfo, setFileInfo] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setCandidates([]);
    setPrims([]);
    try {
      const text = await readDxfText(file);
      const { candidates, entityCount, prims } = findRectangles(text);
      setCandidates(candidates.slice(0, 40));
      setPrims(prims);
      setFileInfo(`${file.name} — 図形 ${entityCount} 個 / 線 ${prims.length} 本 から候補 ${candidates.length} 件`);
      if (candidates.length === 0) setError('図形が見つかりませんでした。手入力に切り替えてください。');
    } catch (e) {
      setError(`読み込めませんでした: ${String(e)}`);
    }
  };

  /** 選んだ範囲の図をその面の下敷きにする。三面図から1面だけ切り出す。 */
  const useAsUnderlay = (c: RectCandidate) => {
    setUnderlay(target, extractRegion(prims, { x: c.x, y: c.y, w: c.w, h: c.h }));
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
            DXF を読み込むと、<b>線で囲まれた四角</b>を拾って並べます。実際の図面では外形が
            閉じたポリラインではなく4本の線で描かれているため、線から組み立てています。
            ブロックは展開し、文字・寸法線は除いています。
            <b>どれが外形でどれが中板かは選んでください。</b>
            三面図が1ファイルに同居していて機械任せにはできません。
          </p>
          <p className="note">
            <b>「下敷きに」</b>を押すと、その四角の中の図だけを切り出して、選んだ面のキャンバスに
            実寸のまま敷きます。三面図から1面だけ取り出せます。
          </p>
          <input
            type="file"
            accept=".dxf"
            onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
          />
          {fileInfo && <p className="calc">{fileInfo}</p>}
          {error && <p className="calc bad">{error}</p>}
          {candidates.length > 0 && (
            <>
              <label className="sel underlay-target">
                <span>「下敷きに」で使う面</span>
                <select value={target} onChange={(e) => setTarget(e.target.value as FaceId)}>
                  {FACES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {underlays[f.id] ? '（設定済み）' : ''}
                    </option>
                  ))}
                </select>
              </label>
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
                        <button className="primary" onClick={() => useAsUnderlay(c)}>
                          下敷きに
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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
      <p className="note warn">
        ⚠ <b>側面図から拾った奥行きには扉が含まれていないことがあります。</b>
        本体だけの寸法が出るためで、扉の厚みぶん実物より小さくなります。
        外形の奥行きは実際の値（扉を含む）に直してください。
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
