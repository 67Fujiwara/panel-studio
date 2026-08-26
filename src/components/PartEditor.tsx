import { useState } from 'react';
import { extractShape, readDxfText } from '../lib/dxfImport';
import { machiningLabel } from '../lib/machining';
import { PartFigure } from './PartFigure';
import { CutFields, HolePicker } from './HolePicker';
import { ShapePreview } from './ShapeGeometry';
import { useStore } from '../store';
import { splitModels } from '../types';
import type { CategoryDef, DeviceSpec, MachiningDraft, MountType } from '../types';

const MOUNTS: { id: MountType; label: string }[] = [
  { id: 'din', label: 'DINレール' },
  { id: 'direct', label: '直付け' },
];

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="num">
      <span>{label}</span>
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

/** 部品1件の編集フォーム。ConfigFile 画面と MyConfig 画面で共用する。 */
export function PartEditor({ part, categories }: { part: DeviceSpec; categories: CategoryDef[] }) {
  const update = useStore((s) => s.updatePart);
  const remove = useStore((s) => s.removePart);

  const holes = part.mountHoles ?? { pitchX: 0, pitchY: 0, countX: 2, countY: 2, dia: 4.5 };
  const cut = part.panelCutout;
  const cl = part.clearance ?? {};
  const color = categories.find((c) => c.id === part.category)?.color ?? '#7d8894';

  const [shapeMsg, setShapeMsg] = useState('');
  const [sideMsg, setSideMsg] = useState('');
  const [cutPickOpen, setCutPickOpen] = useState(false);

  const importShape = async (file: File | undefined) => {
    if (!file) return;
    setShapeMsg('');
    try {
      const shape = extractShape(await readDxfText(file));
      if (!shape) {
        setShapeMsg('図形が見つかりませんでした。');
        return;
      }
      // 取り込んだ外接寸法をそのまま外形サイズにする（あとから直せる）
      update(part.id, { shape, size: { ...part.size, w: shape.w, h: shape.h } });
      setShapeMsg(`${file.name} — 線 ${shape.entities.length} 本 / ${shape.w}×${shape.h}`);
    } catch (e) {
      setShapeMsg(`読み込めませんでした: ${String(e)}`);
    }
  };

  const importSideShape = async (file: File | undefined) => {
    if (!file) return;
    setSideMsg('');
    try {
      const shape = extractShape(await readDxfText(file));
      if (!shape) {
        setSideMsg('図形が見つかりませんでした。');
        return;
      }
      // 側面図は表示時に 奥行き×高さ へ拡縮するので、外形サイズには触らない
      update(part.id, { sideShape: shape });
      setSideMsg(`${file.name} — 線 ${shape.entities.length} 本 / ${shape.w}×${shape.h}`);
    } catch (e) {
      setSideMsg(`読み込めませんでした: ${String(e)}`);
    }
  };

  return (
    <div className="parteditor">
      <div className="parteditor-head">
        <strong>{part.model || '（型式未入力）'}</strong>
        <button onClick={() => remove(part.id)} aria-label="この部品を削除">
          削除
        </button>
      </div>

      <div className="grid2">
        <Txt label="型式" value={part.model} onChange={(model) => update(part.id, { model })} />
        <Txt label="メーカー" value={part.maker} onChange={(maker) => update(part.id, { maker })} />
        <Txt label="品名" value={part.name} onChange={(name) => update(part.id, { name })} />
        <label className="num">
          <span>分類</span>
          <select
            value={part.category}
            onChange={(e) => update(part.id, { category: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {part.model.includes(',') || part.model.includes('，') ? (
        <p className="note">
          型式が<b>カンマ区切り</b>なので、BOM・見積依頼にはそれぞれ別の行で載ります:{' '}
          {splitModels(part.model).join(' ／ ')}
        </p>
      ) : (
        <p className="note">
          端子台に載せるリレーのように<b>置くのは1個でも買い物は複数型式</b>のときは、
          型式を「ソケット,リレー」とカンマで並べると全部 BOM に載ります。
        </p>
      )}

      <h4>外形線（CAD から取り込む）</h4>
      <p className="note">
        DXF を読み込むと、ただの四角ではなく<b>実際の形</b>で描きます。寸法線・文字・
        ハッチは落として、外形線だけを取り込みます。取り込んだ外接寸法が外形サイズになります。
      </p>
      <div className="shaperow">
        <div>
          <input
            type="file"
            accept=".dxf"
            onChange={(e) => void importShape(e.target.files?.[0] ?? undefined)}
          />
          {shapeMsg && <p className="calc">{shapeMsg}</p>}
          {part.shape && (
            <button onClick={() => update(part.id, { shape: undefined })}>
              形状を消して四角に戻す
            </button>
          )}
        </div>
        {part.shape && <ShapePreview shape={part.shape} color={color} />}
      </div>

      <h4>側面の外形線（干渉確認用）</h4>
      <p className="note">
        側面から見た形の DXF を登録すると、左右側面の図に<b>薄く投影</b>されます。
        奥行き方向の当たり（扉に届かないか等）を目で確認するためのもので、
        配置や加工には使いません。<b>中板側を左・扉側を右</b>にした図で取り込んでください
        （縮尺は問いません。表示時に 奥行き×高さ に合わせます）。
      </p>
      <div className="shaperow">
        <div>
          <input
            type="file"
            accept=".dxf"
            onChange={(e) => void importSideShape(e.target.files?.[0] ?? undefined)}
          />
          {sideMsg && <p className="calc">{sideMsg}</p>}
          {part.sideShape && (
            <button onClick={() => update(part.id, { sideShape: undefined })}>
              側面の形状を消す
            </button>
          )}
        </div>
        {part.sideShape && <ShapePreview shape={part.sideShape} color={color} />}
      </div>

      <h4>外形サイズ</h4>
      <div className="grid2">
        <Num
          label="幅"
          value={part.size.w}
          onChange={(w) => update(part.id, { size: { ...part.size, w } })}
          step={0.1}
        />
        <Num
          label="高さ"
          value={part.size.h}
          onChange={(h) => update(part.id, { size: { ...part.size, h } })}
          step={0.1}
        />
        <Num
          label="奥行き（突出）"
          value={part.size.d}
          onChange={(d) => update(part.id, { size: { ...part.size, d } })}
          step={0.1}
        />
      </div>

      <h4>取付方式</h4>
      <div className="mountpick">
        {MOUNTS.map((m) => (
          <label key={m.id} className="check">
            <input
              type="checkbox"
              checked={part.mount.includes(m.id)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...part.mount, m.id]
                  : part.mount.filter((x) => x !== m.id);
                update(part.id, { mount: next.length ? next : [m.id] });
              }}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      <h4>DINレールからのオフセット</h4>
      <p className="note">
        DINレール取付のときに、レール中心から上下にどれだけずらすか。
        <b>0 ならレール中心に合わせます。</b>プラスで上、マイナスで下にずれます。
      </p>
      <div className="grid2">
        <Num
          label="オフセット"
          value={part.dinOffset ?? 0}
          onChange={(dinOffset) => update(part.id, { dinOffset })}
          step={0.5}
        />
      </div>

      {/* 加工まわりは2列にして、右に実寸比のプレビューを常に出す */}
      <div className="machcols">
        <div className="machform">
      <h4>取付穴（ピッチとサイズ）</h4>
      <p className="note">
        直付けのときの<b>ケガキ座標</b>と取付ネジ本数に使います。中心からピッチで展開します。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(part.mountHoles)}
          onChange={(e) => update(part.id, { mountHoles: e.target.checked ? holes : undefined })}
        />
        <span>取付穴を設定する</span>
      </label>
      {part.mountHoles && (
        <div className="grid2">
          <Num
            label="横ピッチ"
            value={holes.pitchX}
            onChange={(pitchX) => update(part.id, { mountHoles: { ...holes, pitchX } })}
            step={0.5}
          />
          <Num
            label="縦ピッチ"
            value={holes.pitchY}
            onChange={(pitchY) => update(part.id, { mountHoles: { ...holes, pitchY } })}
            step={0.5}
          />
          <Num
            label="横の穴数"
            value={holes.countX}
            onChange={(countX) => update(part.id, { mountHoles: { ...holes, countX } })}
          />
          <Num
            label="縦の穴数"
            value={holes.countY}
            onChange={(countY) => update(part.id, { mountHoles: { ...holes, countY } })}
          />
          <Num
            label="穴径 φ"
            value={holes.dia}
            onChange={(dia) => update(part.id, { mountHoles: { ...holes, dia } })}
            step={0.1}
          />
        </div>
      )}

      <h4>パネル開口</h4>
      <label className="num">
        <span>種類</span>
        <select
          value={cut?.kind ?? 'none'}
          onChange={(e) => {
            const v = e.target.value;
            update(part.id, {
              panelCutout:
                v === 'hole'
                  ? { kind: 'hole', dia: 22 }
                  : v === 'notch'
                    ? { kind: 'notch', w: 100, h: 100 }
                    : undefined,
            });
          }}
        >
          <option value="none">なし</option>
          <option value="hole">丸穴</option>
          <option value="notch">角穴</option>
        </select>
      </label>
      {cut?.kind === 'hole' && (
        <div className="grid2">
          <Num
            label="径 φ"
            value={cut.dia}
            onChange={(dia) => update(part.id, { panelCutout: { kind: 'hole', dia } })}
            step={0.5}
          />
        </div>
      )}
      {cut?.kind === 'notch' && (
        <div className="grid2">
          <Num
            label="幅"
            value={cut.w}
            onChange={(w) => update(part.id, { panelCutout: { kind: 'notch', w, h: cut.h } })}
          />
          <Num
            label="高さ"
            value={cut.h}
            onChange={(h) => update(part.id, { panelCutout: { kind: 'notch', w: cut.w, h } })}
          />
        </div>
      )}

      <h4>追加加工（直付けのとき）</h4>
      <p className="note">
        メーカーのキャビスタと同じ穴種を部品に持たせられます。位置は<b>部品の中心からのずれ</b>で、
        配置すると面の座標に展開されます（回転にも付いてきます）。
        取付穴のピッチで足りない、ダルマ穴や D穴・キー溝が要る部品はここで登録します。
        <b>タップ穴を持たせた部品は中板にしか取り付けられなくなります</b>
        （タップは板の裏からナットを当てられない中板だから成り立つ加工のため）。
      </p>
      {(part.extraCuts ?? []).map((c, i) => (
        <div key={i} className="cutedit">
          <div className="cutedit-head">
            <strong>{machiningLabel({ ...c, id: '', face: 'plate' })}</strong>
            <button
              className="cut-del"
              aria-label="削除"
              onClick={() =>
                update(part.id, { extraCuts: (part.extraCuts ?? []).filter((_, j) => j !== i) })
              }
            >
              ×
            </button>
          </div>
          <div className="cutedit-body">
            <CutFields
              value={c}
              tapOk={true}
              posLabel={['中心からX', '中心からY']}
              onChange={(v) =>
                update(part.id, {
                  extraCuts: (part.extraCuts ?? []).map((q, j) => (j === i ? v : q)),
                })
              }
            />
          </div>
        </div>
      ))}
      <div className="row-buttons">
        <button
          className={cutPickOpen ? 'on' : undefined}
          onClick={() => setCutPickOpen((v) => !v)}
        >
          ＋ カタログから追加…
        </button>
      </div>
      {cutPickOpen && (
        <HolePicker
          onPick={(make) => {
            const draft: MachiningDraft = make(0, 0);
            update(part.id, { extraCuts: [...(part.extraCuts ?? []), draft] });
            setCutPickOpen(false);
          }}
        />
      )}

        </div>
        <PartFigure part={part} color={color} />
      </div>

      <h4>メーカー指定の最小離隔・発熱</h4>
      <div className="grid2">
        <Num
          label="上"
          value={cl.top ?? 0}
          onChange={(top) => update(part.id, { clearance: { ...cl, top } })}
        />
        <Num
          label="下"
          value={cl.bottom ?? 0}
          onChange={(bottom) => update(part.id, { clearance: { ...cl, bottom } })}
        />
        <Num
          label="左"
          value={cl.left ?? 0}
          onChange={(left) => update(part.id, { clearance: { ...cl, left } })}
        />
        <Num
          label="右"
          value={cl.right ?? 0}
          onChange={(right) => update(part.id, { clearance: { ...cl, right } })}
        />
        <Num
          label="発熱 W"
          value={part.heatW ?? 0}
          onChange={(heatW) => update(part.id, { heatW })}
          step={0.5}
        />
      </div>
    </div>
  );
}
