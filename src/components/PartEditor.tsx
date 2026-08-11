import { useStore } from '../store';
import type { CategoryDef, DeviceSpec, MountType } from '../types';

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
