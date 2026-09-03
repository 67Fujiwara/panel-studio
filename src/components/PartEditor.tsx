import { useState } from 'react';
import { extractShape, readDxfText } from '../lib/dxfImport';
import { machiningLabel } from '../lib/machining';
import { PartFigure } from './PartFigure';
import { CutFields, HolePicker } from './HolePicker';
import { ShapePreview } from './ShapeGeometry';
import { useStore } from '../store';
import { splitModels } from '../types';
import type { CategoryDef, DeviceSpec, MachiningDraft, MountType } from '../types';

const MOUNTS: { id: MountType; label: string; hint: string }[] = [
  { id: 'din', label: 'DINレール', hint: '段の共通レールに掛ける（同じ段の機器と1本を分け合う）' },
  { id: 'direct', label: '直付け', hint: '面に直接ネジ留めする' },
  {
    id: 'din-solo',
    label: '独立DINレール',
    hint: 'その機器だけの短いレールに掛ける。レールは中板に2点で留める',
  },
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

/**
 * 折りたたみの見出し。
 *
 * 部品に持たせる項目が増えて、1件の編集が縦に長くなりすぎた。
 * **たたんだ状態でも中身が分かる**ように、見出しの右へ要約を出す。
 * 開いた／閉じたは覚えるので、いつも触る項目だけ開いたまま次の部品へ移れる。
 */
function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`sect${open ? ' open' : ''}`}>
      <button type="button" className="secthead" aria-expanded={open} onClick={onToggle}>
        <span className="caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="secttitle">{title}</span>
        <span className="sectsum">{summary}</span>
      </button>
      {open && <div className="sectbody">{children}</div>}
    </div>
  );
}

/** 開いている見出しの覚え書き。部品を選び直しても同じ開き方で出したい */
const OPEN_KEY = 'panel-studio.parteditor-open';

function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveOpen(v: Record<string, boolean>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(v));
  } catch {
    /* 覚えられなくても、このセッション中は効く */
  }
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
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(loadOpen);

  /*
   * 見出しの既定は「中身が入っていれば開く」。
   * 触ったことのある見出しは、その人が決めた開き方を優先する（openMap）。
   * 一度もいじっていない部品でも、設定済みの項目だけが開いて見える。
   */
  const nz = (v: number | undefined) => Boolean(v);
  const cuts = part.extraCuts ?? [];
  const hasClearance =
    nz(cl.top) || nz(cl.bottom) || nz(cl.left) || nz(cl.right) || nz(part.heatW);
  const filled: Record<string, boolean> = {
    shape: Boolean(part.shape),
    side: Boolean(part.sideShape),
    size: true,
    mount: true,
    base: Boolean(part.baseUnit),
    slot: part.slotUse !== undefined && part.slotUse !== 1,
    offset: nz(part.dinOffset),
    holes: Boolean(part.mountHoles),
    cutout: Boolean(cut),
    cuts: cuts.length > 0,
    clearance: hasClearance,
  };
  const isOpen = (id: string) => openMap[id] ?? filled[id] ?? false;
  const toggle = (id: string) =>
    setOpenMap((v) => {
      const next = { ...v, [id]: !isOpen(id) };
      saveOpen(next);
      return next;
    });
  const setAll = (open: boolean) => {
    const next = Object.fromEntries(Object.keys(filled).map((k) => [k, open]));
    saveOpen(next);
    setOpenMap(next);
  };
  const sect = (id: string, title: string, summary: string, children: React.ReactNode) => (
    <Section title={title} summary={summary} open={isOpen(id)} onToggle={() => toggle(id)}>
      {children}
    </Section>
  );
  const mm = (v: number) => String(Math.round(v * 100) / 100);
  /** 加工まわりを1つでも開いているか。プレビューを出すかどうかの判断に使う */
  const machOpen = isOpen('holes') || isOpen('cutout') || isOpen('cuts');

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
        <button onClick={() => setAll(true)}>すべて開く</button>
        <button onClick={() => setAll(false)}>すべて閉じる</button>
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

      {sect(
        'shape',
        '外形線（CAD から取り込む）',
        part.shape ? `取り込み済み — 線 ${part.shape.entities.length} 本` : 'なし（四角で描画）',
        <>
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
        </>,
      )}

      {sect(
        'side',
        '側面の外形線（干渉確認用）',
        part.sideShape ? `取り込み済み — 線 ${part.sideShape.entities.length} 本` : 'なし',
        <>
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
        </>,
      )}

      {sect(
        'size',
        '外形サイズ',
        `${mm(part.size.w)} × ${mm(part.size.h)} × ${mm(part.size.d)}`,
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
        </div>,
      )}

      {sect(
        'mount',
        '取付方式',
        MOUNTS.filter((m) => part.mount.includes(m.id))
          .map((m) => m.label)
          .join('・') || '未設定',
        <>
          <div className="mountpick">
            {MOUNTS.map((m) => (
              <label key={m.id} className="check" title={m.hint}>
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
          <p className="note">
            <b>独立DINレール</b>は、その機器だけの短いレールに掛ける取付です。段の共通レールには
            乗らないので、<b>段に並べても座標で置いてもレールが機器に付いてきます</b>
            （置き方はレイアウト画面の「置き方」で切り替えます）。レールは機器幅＋両端の余長で
            切り出し、<b>中板には両端の2点</b>で留めます。中板だけで使えます。
            隣に別の機器が並ぶときは、<b>エンドストッパのぶん(5mm)を機器⇔機器のクリアランスとは
            別に空けます</b>（ストッパが隣に重なるのを防ぐため）。
          </p>
        </>,
      )}

      {sect(
        'base',
        'ベースユニット（PLC）',
        part.baseUnit
          ? `ポート数 ${part.baseUnit.slots}${part.baseUnit.pitch > 0 ? ` / ピッチ ${mm(part.baseUnit.pitch)}` : ' / 実寸詰め'}`
          : 'なし',
        <>
          <p className="note">
        三菱の PLC のように、<b>電源・CPU・入出力ユニットを横に並べて載せる台</b>ならここを
        設定します。ポート数（スロット数）を決めておくと、レイアウト画面で
        <b>OP に足したユニットが左から順にきれいに嵌まり</b>、はみ出しやスロット不足は
        チェックに出ます。載せるユニット側は下の「ベースの占有スロット」で数えます。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(part.baseUnit)}
          onChange={(e) =>
            update(part.id, {
              baseUnit: e.target.checked
                ? (part.baseUnit ?? { slots: 5, offset: 0, pitch: 0, bottom: 0 })
                : undefined,
            })
          }
        />
        <span>この部品はベースユニット</span>
      </label>
      {part.baseUnit && (
        <>
          <div className="grid2">
            <Num
              label="ポート数（スロット）"
              value={part.baseUnit.slots}
              onChange={(slots) =>
                update(part.id, { baseUnit: { ...part.baseUnit!, slots: Math.max(1, slots) } })
              }
            />
            <Num
              label="1台目までの左余白"
              value={part.baseUnit.offset}
              onChange={(offset) => update(part.id, { baseUnit: { ...part.baseUnit!, offset } })}
              step={0.1}
            />
            <Num
              label="スロット幅"
              value={part.baseUnit.pitch}
              onChange={(pitch) =>
                update(part.id, { baseUnit: { ...part.baseUnit!, pitch: Math.max(0, pitch) } })
              }
              step={0.1}
            />
            <Num
              label="下端からの高さ"
              value={part.baseUnit.bottom}
              onChange={(bottom) => update(part.id, { baseUnit: { ...part.baseUnit!, bottom } })}
              step={0.1}
            />
          </div>
          <p className="note">
            <b>スロット幅を 0 にすると、各ユニットの実寸で詰めて並べます。</b>
            三菱のようにユニットの幅がまちまち（電源 55mm・I/O 28mm など）なら 0 のままが
            実物どおりです。数値を入れると等ピッチの枠に左寄せで嵌めます。
          </p>
        </>
      )}
        </>,
      )}

      {sect(
        'slot',
        'ベースの占有スロット',
        `${part.slotUse ?? 1} 枠${(part.slotUse ?? 1) === 0 ? '（別枠で付く）' : ''}`,
        <>
          <p className="note">
            この部品を<b>ベースに載せたとき</b>に使うスロット数です。既定は 1。
            <b>0 にするとスロットを使いません</b>（三菱の電源・CPU のように、I/O スロットとは
            別枠で付くもの）。幅2枠を占めるユニットは 2 にします。
          </p>
          <div className="grid2">
            <Num
              label="占有スロット"
              value={part.slotUse ?? 1}
              onChange={(slotUse) => update(part.id, { slotUse: Math.max(0, slotUse) })}
            />
          </div>
        </>,
      )}

      {sect(
        'offset',
        'DINレールからのオフセット',
        nz(part.dinOffset) ? `${mm(part.dinOffset ?? 0)} mm` : '0（レール中心）',
        <>
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
        </>,
      )}

      {/*
        加工まわりは2列にして、右に実寸比のプレビューを出す。
        3つとも閉じているときは見るものが無いので、プレビューごと畳んで1列にする
      */}
      <div className={`machcols${machOpen ? '' : ' solo'}`}>
        <div className="machform">
          {sect(
            'holes',
            '取付穴（ピッチとサイズ）',
            part.mountHoles
              ? `${holes.countX}×${holes.countY} 点 / ピッチ ${mm(holes.pitchX)}×${mm(holes.pitchY)} / φ${mm(holes.dia)}`
              : 'なし',
            <>
              <p className="note">
                直付けのときの<b>ケガキ座標</b>と取付ネジ本数に使います。中心からピッチで展開します。
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(part.mountHoles)}
                  onChange={(e) =>
                    update(part.id, { mountHoles: e.target.checked ? holes : undefined })
                  }
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
            </>,
          )}

          {sect(
            'cutout',
            'パネル開口',
            cut?.kind === 'hole'
              ? `丸穴 φ${mm(cut.dia)}`
              : cut?.kind === 'notch'
                ? `角穴 ${mm(cut.w)}×${mm(cut.h)}`
                : 'なし',
            <>
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
                    onChange={(w) =>
                      update(part.id, { panelCutout: { kind: 'notch', w, h: cut.h } })
                    }
                  />
                  <Num
                    label="高さ"
                    value={cut.h}
                    onChange={(h) =>
                      update(part.id, { panelCutout: { kind: 'notch', w: cut.w, h } })
                    }
                  />
                </div>
              )}
            </>,
          )}

          {sect(
            'cuts',
            '追加加工（直付けのとき）',
            cuts.length > 0
              ? `${cuts.length} 件 — ${cuts
                  .map((c) => machiningLabel({ ...c, id: '', face: 'plate' }))
                  .join('・')}`
              : 'なし',
            <>
              <p className="note">
                メーカーのキャビスタと同じ穴種を部品に持たせられます。位置は
                <b>部品の中心からのずれ</b>で、配置すると面の座標に展開されます（回転にも付いてきます）。
                取付穴のピッチで足りない、ダルマ穴や D穴・キー溝が要る部品はここで登録します。
                <b>タップ穴を持たせた部品は中板にしか取り付けられなくなります</b>
                （タップは板の裏からナットを当てられない中板だから成り立つ加工のため）。
              </p>
              {cuts.map((c, i) => (
                <div key={i} className="cutedit">
                  <div className="cutedit-head">
                    <strong>{machiningLabel({ ...c, id: '', face: 'plate' })}</strong>
                    <button
                      className="cut-del"
                      aria-label="削除"
                      onClick={() =>
                        update(part.id, { extraCuts: cuts.filter((_, j) => j !== i) })
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
                        update(part.id, { extraCuts: cuts.map((q, j) => (j === i ? v : q)) })
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
                    update(part.id, { extraCuts: [...cuts, draft] });
                    setCutPickOpen(false);
                  }}
                />
              )}
            </>,
          )}
        </div>
        {machOpen && <PartFigure part={part} color={color} />}
      </div>

      {sect(
        'clearance',
        'メーカー指定の最小離隔・発熱',
        hasClearance
          ? `上${mm(cl.top ?? 0)} 下${mm(cl.bottom ?? 0)} 左${mm(cl.left ?? 0)} 右${mm(cl.right ?? 0)}` +
            (nz(part.heatW) ? ` / ${mm(part.heatW ?? 0)}W` : '')
          : '指定なし',
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
        </div>,
      )}
    </div>
  );
}
