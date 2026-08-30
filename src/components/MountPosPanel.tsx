import type { DeviceLookup } from '../lib/layout';
import { rotatedSize } from '../types';
import { useStore } from '../store';
import type { LayoutResult } from '../types';

/**
 * 中板での「置き方」。選択中の1台を、段割りに任せるか座標で決めるかを切り替える。
 *
 * 直付けの機器は DIN 機器と同じ段に並ぶのが既定だが、実物ではレールの列から
 * 外して好きな位置へ付けることも多い（変圧器・抵抗器・端子台の脇など）。
 * Shift ドラッグでも固定はできるが、「座標で置きたい」人は数値で打ちたい人なので、
 * X/Y の入力欄まで付けて1つの箱にまとめた。
 *
 * 中身は pinned（手動固定）そのもの — 新しい仕組みは増やしていない。
 */
export function MountPosPanel({ layout, devices }: { layout: LayoutResult; devices: DeviceLookup }) {
  const face = useStore((s) => s.face);
  const selectedUid = useStore((s) => s.selectedUid);
  const items = useStore((s) => s.items);
  const pinned = useStore((s) => s.pinned);
  const pin = useStore((s) => s.pin);
  const unpin = useStore((s) => s.unpin);
  const setCenter = useStore((s) => s.setCenter);

  const item = items.find((i) => i.uid === selectedUid && i.face === face);
  const spec = item ? devices.get(item.specId) : undefined;
  const placed = layout.placed.find((p) => p.uid === selectedUid);
  if (!item || !spec || !placed) return null;

  const size = rotatedSize(spec.size, placed.rot);
  const isFree = pinned.some((p) => p.uid === item.uid);
  const cx = Math.round((placed.x + size.w / 2) * 10) / 10;
  const cy = Math.round((placed.y + size.h / 2) * 10) / 10;
  const solo = item.mount === 'din-solo';

  return (
    <div className="opbox">
      <h2>
        置き方 <span className="dim">{spec.model} の選択中の1台</span>
      </h2>
      {solo && (
        <p className="note">
          <b>独立DINレール</b>の機器です。レールは<b>この1台に付いてくる</b>ので、段に並べても
          座標で置いてもレールごと動きます（レールの固定穴は両端の2点）。
        </p>
      )}
      <div className="row-buttons">
        <button
          className={isFree ? undefined : 'on primary'}
          onClick={() => unpin(item.uid)}
          title={
            solo
              ? '他の機器と同じ段に自動で並べます（レールも一緒に動きます）'
              : 'DINレールの機器と同じ段に自動で並べます'
          }
        >
          段に並べる（自動）
        </button>
        <button
          className={isFree ? 'on primary' : undefined}
          // いまの位置のまま固定に切り替える。切り替えた瞬間に動かない
          onClick={() => pin(placed)}
          title="段から外して、座標で位置を決めます"
        >
          座標で置く
        </button>
      </div>
      {isFree ? (
        <div className="grid2">
          <label className="num">
            <span>中心X</span>
            <input
              type="number"
              value={cx}
              onChange={(e) => setCenter(placed, size, Number(e.target.value), cy)}
            />
          </label>
          <label className="num">
            <span>中心Y</span>
            <input
              type="number"
              value={cy}
              onChange={(e) => setCenter(placed, size, cx, Number(e.target.value))}
            />
          </label>
        </div>
      ) : (
        <p className="note">
          いまは段割りに任せています。「座標で置く」にすると、この位置のまま固定され、
          中心座標を数値で打てます（Shift＋ドラッグでも動かせます）。
        </p>
      )}
    </div>
  );
}
