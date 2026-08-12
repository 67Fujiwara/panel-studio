import { useState } from 'react';
import { FACES, FACE_LABEL } from '../data/faces';
import {
  analyzeCabinet,
  analyzePlate,
  extractRegion,
  findRectangles,
  flatten,
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
 * DXF のファイル名から盤の型式を作る。
 * メーカーのダウンロードは型式そのままのファイル名なので、そのまま使える。
 * ブラウザが付ける連番（`[1]` など）と拡張子だけ落とす。
 */
function modelFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[[(]\d+[\])]$/, '').trim();
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
  const enclosures = useStore((s) => s.enclosures);
  const go = useStore((s) => s.go);

  const setUnderlay = useStore((s) => s.setUnderlay);
  const underlays = useStore((s) => s.underlays);

  const [tab, setTab] = useState<'manual' | 'dxf'>('manual');
  const [candidates, setCandidates] = useState<RectCandidate[]>([]);
  const [prims, setPrims] = useState<Prim[]>([]);
  const [target, setTarget] = useState<FaceId>('plate');
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string>('');

  /**
   * キャビネット（外形の三面図）。
   * 面の並びから外形寸法を自動で割り出し、各面の図をそのまま下敷きに敷く。
   */
  const onCabinet = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const text = await readDxfText(file);
      // 面の割り出しは寸法線を落とした図で、下敷きは文字以外すべてで
      const shapeOnly = flatten(text, 'shape').prims;
      const everything = flatten(text, 'all').prims;
      const found = analyzeCabinet(shapeOnly);
      if (!found) {
        setError(`${file.name}: 図形が見つかりませんでした。手動で選ぶか手入力にしてください。`);
        return;
      }
      setOuter(found.outer);
      const model = modelFromFileName(file.name);
      if (model) setPanel({ model });
      for (const r of found.regions) {
        setUnderlay(r.face, extractRegion(everything, r));
      }
      // 中板図が無いときのために、外形から見当をつけておく（あとで上書きされる）
      setPlate({
        w: Math.max(50, found.outer.w - 60),
        h: Math.max(50, found.outer.h - 60),
      });
      // 手動で選び直したいときのために候補も出しておく
      const { candidates } = findRectangles(text);
      setCandidates(candidates.slice(0, 40));
      setPrims(everything);
    } catch (e) {
      setError(`読み込めませんでした: ${String(e)}`);
    }
  };

  /** 中板の図。1枚しか描かれていないので、いちばん大きな四角をそのまま採る。 */
  const onPlate = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const text = await readDxfText(file);
      const found = analyzePlate(text);
      if (!found) {
        setError(`${file.name}: 四角が見つかりませんでした。手入力にしてください。`);
        return;
      }
      setPlate({ w: found.w, h: found.h });
      setUnderlay('plate', extractRegion(flatten(text, 'all').prims, found));
    } catch (e) {
      setError(`読み込めませんでした: ${String(e)}`);
    }
  };

  /** 選んだ範囲の図をその面の下敷きにする。自動判定を直したいときの逃げ道。 */
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
              value={enclosures.some((p) => p.model === panel.model) ? panel.model : ''}
              onChange={(e) => {
                const found = enclosures.find((p) => p.model === e.target.value);
                if (found) setPanel(found);
              }}
            >
              {/* 今の盤が未登録のときに、選択が勝手に別の型式へ飛ばないようにする */}
              {!enclosures.some((p) => p.model === panel.model) && (
                <option value="">（未登録）{panel.model}</option>
              )}
              {enclosures.map((p) => (
                <option key={p.model}>{p.model}</option>
              ))}
            </select>
          </label>
          <p className="note">
            型式の登録・編集は<b>設定</b>画面の「盤マスタ」で行います。
          </p>
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
            <b>キャビネットと中板を別々に読み込みます。</b>
            キャビネットの図は第三角法の三面図なので、面の並びから
            <b>外形寸法を自動で判定</b>し、そのまま各面の下敷きにします。
            文字は落としますが、<b>それ以外の線はすべて</b>取り込みます。
          </p>

          <div className="dxfslot">
            <h4>キャビネット（外形の三面図）</h4>
            <input
              type="file"
              accept=".dxf,.DXF"
              onChange={(e) => void onCabinet(e.target.files?.[0] ?? undefined)}
            />
          </div>

          <div className="dxfslot">
            <h4>中板</h4>
            <input
              type="file"
              accept=".dxf,.DXF"
              onChange={(e) => void onPlate(e.target.files?.[0] ?? undefined)}
            />
          </div>

          {error && <p className="calc bad">{error}</p>}

          <p className="note">
            判定結果は下の「外形」「中板」の数値に入ります。
            <b>違っていたらそのまま直してください。</b>
          </p>

          {candidates.length > 0 && (
            <details className="cands-fallback" open={manualOpen}>
              <summary onClick={() => setManualOpen((v) => !v)}>
                自動判定がずれたとき — 四角を選んで割り当てる（{candidates.length} 件）
              </summary>
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
            </details>
          )}

          {FACES.some((f) => underlays[f.id]) && (
            <p className="note">
              下敷き済み:{' '}
              <b>{FACES.filter((f) => underlays[f.id]).map((f) => FACE_LABEL(f.id)).join('・')}</b>
            </p>
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
      <div className="grid3">
        <Num
          label="背面→中板上面"
          hint="納入仕様書を確認"
          value={panel.depth.backToPlate}
          onChange={(backToPlate) => setDepth({ backToPlate })}
          step={5}
        />
        <Num
          label="扉裏の突出"
          hint="納入仕様書を確認"
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
      </div>
    </div>
  );
}
