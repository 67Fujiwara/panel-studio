/** 段の中身を上のダクトの手前まで上へ詰める。 */
import { DIN_RAIL_WIDTH } from '../../data/enclosures';
import { rotatedSize, rowAxisY } from '../../types';
import type { DeviceRow, Duct, PlacedDevice, Profile } from '../../types';
import { effectiveClearance, rowGap } from './clearance';
import type { DeviceLookup } from './types';

/**
 * 段の中身（DINレールとその段の機器）を、**上のダクトに当たる手前まで上へ詰める**。
 *
 * 段の高さは「いちばん背の高い機器＋その離隔」で決まるので、離隔のぶんだけ
 * 中身が下がったまま置かれることがある。空きは下にまとめたい（配線を通すのは
 * 下側）ので、当たらないなら上へ寄せる。
 *
 * - 動かすのは**段ごと（レールごと）**。DINレールの機器はレールから外せないので、
 *   1台だけ上げることはできない。段の中身が丸ごと同じだけ上がる
 * - 止まるのは**どれか1台がダクト（または上の段の機器）に当たる手前**。
 *   1台でも当たるなら、その手前で段ぜんたいが止まる
 * - 座標で置いた機器（pinned）は段の流れから外れているので動かさない
 * - 段どうしの間隔（機器⇔機器 betweenRows）は詰めない。ダクトへは
 *   **機器⇔ダクトの離隔の手前まで**詰める。ここを接するところまで詰めてしまうと、
 *   上に取ってあった離隔がそのまま下の空きへ回り、「上に 0・下に 2倍」に見える
 *
 * 段は上から順に処理する。上の段が先に上がれば、その下の段はさらに上がれる。
 */
export function pushRowsUp(
  rows: DeviceRow[],
  ducts: Duct[],
  placed: PlacedDevice[],
  devices: DeviceLookup,
  faceH: number,
  profile: Profile,
): void {
  const betweenRows = profile.clearance.deviceToDevice.betweenRows;
  const box = (p: PlacedDevice) => {
    const spec = devices.get(p.specId);
    if (!spec) return null;
    const s = rotatedSize(spec.size, p.rot);
    return { x0: p.x, x1: p.x + s.w, y0: p.y, y1: p.y + s.h };
  };
  const live = ducts.filter((d) => !d.removed);

  for (const row of [...rows].sort((a, b) => b.y - a.y)) {
    // その段を流れている機器と、段のレールに乗ったままの座標置き（onRail）。
    // 上下に動かしてレールから外した座標置きは動かさない
    const mine = placed.filter((p) => p.row === row.index && (!p.pinned || p.onRail));
    if (mine.length === 0) continue;
    const others = placed.filter((p) => !mine.includes(p));
    const gap = rowGap(profile, row.index);

    let shift = Infinity;
    /** clr はその1台がダクトとの間に残しておく離隔。レールの帯には離隔を求めない */
    const limitBy = (b: { x0: number; x1: number; y1: number }, clr: number) => {
      // 面の上端
      shift = Math.min(shift, faceH - b.y1);
      for (const d of live) {
        if (d.x + d.w <= b.x0 + 0.01 || b.x1 <= d.x + 0.01) continue;
        if (d.y + 0.01 < b.y1) continue; // 上にあるものだけ
        shift = Math.min(shift, d.y - b.y1 - clr);
      }
      for (const q of others) {
        const o = box(q);
        if (!o) continue;
        if (o.x1 <= b.x0 + 0.01 || b.x1 <= o.x0 + 0.01) continue;
        if (o.y0 + 0.01 < b.y1) continue;
        shift = Math.min(shift, o.y0 - b.y1 - betweenRows);
      }
    };

    for (const p of mine) {
      const b = box(p);
      const spec = devices.get(p.specId);
      if (b && spec) limitBy(b, effectiveClearance(spec, profile.clearance, gap).top);
    }
    // レールの帯もダクトへ食い込ませない
    const railTop = rowAxisY(row) + DIN_RAIL_WIDTH / 2;
    const xs = mine.map((p) => box(p)).filter((b): b is NonNullable<typeof b> => Boolean(b));
    if (xs.length > 0) {
      limitBy(
        {
          x0: Math.min(...xs.map((b) => b.x0)),
          x1: Math.max(...xs.map((b) => b.x1)),
          y1: railTop,
        },
        0,
      );
    }

    if (!Number.isFinite(shift) || shift <= 0.01) continue;

    /*
     * その段の共通レールに乗っている座標置きの機器（矢印キーで左右に寄せた 1 台など）があれば、
     * 段の基準線は**その機器のレールの高さに合わせる**。座標置きの機器は動かさないので、
     * 流し込みの機器だけを上へ詰めると、レールが 2 つの高さに割れて「レールが崩れる」。
     * 合わせるのは、その高さが詰められる範囲（0〜shift）に入っているときだけ。
     * 上下に大きく動かした機器（レールから外した 1 台）に段ごと引っ張られないため
     */
    const axis0 = rowAxisY(row);
    // onRail の印が無い古いデータだけ。印があるものは mine として段と一緒に動く
    const railed = placed
      .filter((p) => p.row === row.index && p.pinned && p.onRail === undefined && p.mount === 'din')
      .map((p) => {
        const spec = devices.get(p.specId);
        if (!spec) return null;
        return p.y + rotatedSize(spec.size, p.rot).h / 2 - (spec.dinOffset ?? 0) - axis0;
      })
      .filter((d): d is number => d !== null && d >= -0.01 && d <= shift + 0.01);
    if (railed.length > 0) shift = Math.max(0, railed[0]!);
    if (shift <= 0.01) continue;
    row.axis = (row.axis ?? row.h / 2) + shift;
    for (const p of mine) p.y += shift;

    /*
     * 段が上へ詰まったら、**その段の下のダクトも同じだけ上げる**。
     *
     * ダクトの位置は段の割り付け（packAuto）が「段の機器を全部ダクトの線から積んだ」高さで決めている。
     * ダクトを短くしてその先に背の高い機器が立つと、その機器はダクトに当たらないので段は上へ詰まるが、
     * ダクトは割り付けの位置に残り、段とダクトの間に設定にない隙間が空いていた。
     * そこへ「下の余白」を増やすと、段は上のダクトとの余白を守って動かず、割り付けの高さだけが下がって
     * **余白が段の下（次のダクトの上）に出る**という見え方になっていた。
     * ダクトが段に付いていけば、上の余白は上に、下の余白は下に、設定どおりに出る。
     *
     * 一緒に動かなかった機器（座標置き）の下をダクトが通るなら、その機器の下端−離隔までしか上げない。
     * 全周囲いの最下段のダクトは面の下端に固定なので動かさない。段の高さが固定の equal モードも動かさない
     */
    if (profile.duct.rowHeightMode !== 'auto') continue;
    const lastId = Math.max(-1, ...ducts.filter((d) => d.vert === undefined).map((d) => d.id));
    const below = ducts.filter((d) => d.vert === undefined && d.id === row.index + 1);
    if (below.length === 0 || (profile.duct.layout === 'perimeter' && row.index + 1 === lastId)) continue;
    let up = shift;
    for (const q of others) {
      const o = box(q);
      const spec = devices.get(q.specId);
      if (!o || !spec) continue;
      const clr = effectiveClearance(spec, profile.clearance, rowGap(profile, q.row)).bottom;
      for (const d of below) {
        if (d.x + d.w <= o.x0 + 0.01 || o.x1 <= d.x + 0.01) continue;
        const ductTop = d.y + d.h;
        if (o.y0 + 0.01 < ductTop) continue; // ダクトより下にある機器は関係ない（離れていく側）
        up = Math.min(up, o.y0 - clr - ductTop);
      }
    }
    if (up <= 0.01) continue;
    for (const d of below) d.y += up;
  }
}
