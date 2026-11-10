/** DINレール。段の共通レールと独立レール、長さの手直し。BOM と作図の両方がここを使う。 */
import { DIN_RAIL_WIDTH } from '../../data/enclosures';
import { isRailMount, rotatedSize, rowAxisY } from '../../types';
import type { DeviceRow, DeviceSpec, LayoutResult, PlacedDevice, RailAdjust } from '../../types';
import { isStopper } from './clearance';
import { RAIL_END_MARGIN, SAME_AXIS_MM, SOLO_RAIL_MARGIN } from './constants';
import type { DeviceLookup } from './types';

export type RailRun = {
  row: number;
  x: number;
  y: number;
  length: number;
  /** 独立レール（段の共通レールではない1本）か */
  solo?: boolean;
  /** 独立レールなら、それを持つ機器（検査で名指しするため） */
  uid?: string;
  /** 手直しの控えのキー（段の共通レールだけ）。RailSettings.adjust を引く */
  key?: string;
  /**
   * 端を動かせる範囲（段の共通レールだけ）。左端は x の範囲、右端は x+length の範囲。
   * 内側は機器の端まで、外側はダクト・直付け機器・独立レールに当たるまで（右は無限のこともある）
   */
  bounds?: { left: { min: number; max: number }; right: { min: number; max: number } };
};

/**
 * 座標で置いた DIN 機器が、どの段の共通レールの高さに居るか。無ければ null。
 *
 * 矢印キーで 1mm 動かしただけで独立レールになると、共通レールが切れて
 * エンドストッパが4個に増え、固定穴も変わる。**レールの高さが段の基準線と同じなら
 * その段の共通レールに乗っている**とみなす。上下に動かして高さが変われば独立レール。
 */
export function rowOfPinnedRail(
  p: PlacedDevice,
  spec: DeviceSpec,
  layout: LayoutResult,
  devices: DeviceLookup,
): DeviceRow | null {
  if (p.mount !== 'din' || !p.pinned) return null;
  const size = rotatedSize(spec.size, p.rot);
  const y = p.y + size.h / 2 - (spec.dinOffset ?? 0);
  const row = layout.rows.find((r) => Math.abs(rowAxisY(r) - y) <= SAME_AXIS_MM);
  if (!row) return null;
  /*
   * 独立DINレール取付の機器の**隣に吸い付けた**ものは、そのレールに乗る（独立レール側）。
   * 同じ高さでも、自分のレール（機器幅＋両端 5mm）が独立レールに触れていればそちら。
   * 触れていなければ段の共通レール。
   */
  const x0 = p.x - SOLO_RAIL_MARGIN;
  const x1 = p.x + size.w + SOLO_RAIL_MARGIN;
  for (const q of layout.placed) {
    if (q.uid === p.uid || q.mount !== 'din-solo') continue;
    const qs = devices.get(q.specId);
    if (!qs) continue;
    const qsize = rotatedSize(qs.size, q.rot);
    const qy = q.y + qsize.h / 2 - (qs.dinOffset ?? 0);
    if (Math.abs(qy - y) > SAME_AXIS_MM) continue;
    if (q.x - SOLO_RAIL_MARGIN <= x1 + 0.01 && x0 <= q.x + qsize.w + SOLO_RAIL_MARGIN + 0.01) return null;
  }
  return row;
}

export function independentRails(
  layout: LayoutResult,
  devices: DeviceLookup,
  exceptUid?: string,
): RailRun[] {
  const runs: RailRun[] = [];
  for (const p of layout.placed) {
    if (p.uid === exceptUid) continue;
    if (!isRailMount(p.mount)) continue;
    if (p.mount !== 'din-solo' && !p.pinned) continue;
    const spec = devices.get(p.specId);
    if (!spec) continue;
    // 段の共通レールの高さに居る座標置きの機器は、共通レールに乗せる（独立にしない）
    if (rowOfPinnedRail(p, spec, layout, devices)) continue;
    const s = rotatedSize(spec.size, p.rot);
    const y = p.y + s.h / 2 - (spec.dinOffset ?? 0);
    const band = { y0: y - DIN_RAIL_WIDTH / 2, y1: y + DIN_RAIL_WIDTH / 2 };
    const blocks = layout.ducts
      .filter((d) => !d.removed && d.y < band.y1 && band.y0 < d.y + d.h)
      .map((d) => ({ x0: d.x, x1: d.x + d.w }));
    const limitLeft = Math.max(0, ...blocks.filter((c) => c.x1 <= p.x + 0.01).map((c) => c.x1));
    const limitRight = Math.min(
      Infinity,
      ...blocks.filter((c) => c.x0 >= p.x + s.w - 0.01).map((c) => c.x0),
    );
    const left = Math.max(limitLeft, p.x - SOLO_RAIL_MARGIN);
    const right = Math.min(limitRight, p.x + s.w + SOLO_RAIL_MARGIN);
    runs.push({ row: p.row, x: left, y, length: Math.max(0, right - left), solo: true, uid: p.uid });
  }
  /*
   * 同じ高さで接している独立レールは1本につなげる。並べた機器はどう見ても
   * 1本のレールに乗っているので、レールが2本・エンドストッパが4個と数えられては困る。
   */
  mergeTouching(runs);
  return runs;
}

/**
 * DINレール。BOM と作図の両方がここを使う。
 * 正面視ではレールは高さ 35mm の帯として見えるので、機器の下端に合わせて描く。
 *
 * レールは2種類ある。
 * - **段の共通レール**: 段に流し込まれた DIN 機器が分け合う1本。両端の余長は設定で変えられる
 * - **独立レール**: 独立DINレール取付の機器と、**段から外して座標で置いた機器**の1本。
 *   機器と一緒に動き、両端 5mm（エンドストッパのぶん）で切る
 *
 * 座標で置いた機器を共通レールに数えないのが要点。数えると、段から遠くへ置くたびに
 * 共通レールがそこまで引き伸ばされる（実物では1本のレールがそんな形で伸びることはない）。
 */
export function computeRails(
  layout: LayoutResult,
  devices: DeviceLookup,
  endMargin: number = RAIL_END_MARGIN,
  /** レールごとの手直し（RailSettings.adjust）。無ければ余長どおり */
  adjust?: Record<string, RailAdjust>,
): RailRun[] {
  const out: RailRun[] = [];

  const railDevices = layout.placed
    .map((p) => ({ p, spec: devices.get(p.specId) }))
    .filter((e): e is { p: PlacedDevice; spec: DeviceSpec } => Boolean(e.spec) && isRailMount(e.p.mount));

  /** 帯（35mm）が重なる高さか。重なるレールどうしは同じ場所に置けない */
  const sameBand = (y1: number, y2: number) => Math.abs(y1 - y2) < DIN_RAIL_WIDTH;

  /*
   * 独立レールを先に決める。段の共通レールには乗らないので、機器と一緒に動く。
   * レールの中心は「機器の中心 − dinOffset」。オフセットは機器がレールからどれだけ
   * ずれて掛かるかなので、独立レールでは機器ではなくレールの側がずれる。
   *
   * 長さは機器幅＋左右 5mm（エンドストッパのぶん）。この 5mm は削れない場所なので、
   * 共通レールより先に取ってしまう。
   */
  const solo = independentRails(layout, devices);

  for (const row of layout.rows) {
    // 座標で置いた機器は段の流れから外れているので、共通レールには数えない。
    // ただし**レールの高さが段の基準線と同じ**なら、その段の共通レールに乗せる
    // （矢印キーで左右に 1mm 寄せただけで独立レールにならないように）
    const inRow = railDevices.filter(
      (e) =>
        e.p.mount === 'din' &&
        (e.p.pinned
          ? rowOfPinnedRail(e.p, e.spec, layout, devices)?.index === row.index
          : e.p.row === row.index),
    );
    if (inRow.length === 0) continue;

    // レールの中心は段の基準線。機器はここから dinOffset ぶんだけずれて掛かる
    // （基準線はオフセットのぶん段の中心からずれていることがある）
    const y = rowAxisY(row);

    /*
      レールをダクトに食い込ませない。
      実物はダクトが先に付いていてレールはその間に入るので、
      図の上で重なっていると切断長を間違える。
      レールが通る高さ（帯 35mm）にかかるダクトだけを見る。

      ゾーン分割や田の字では**縦ダクトが段の真ん中を横切る**。その場合は
      1本で貫かず、切れ目（縦ダクト）の間ごとに機器をまとめて**別々のレール**を引く。
    */
    const band = { y0: y - DIN_RAIL_WIDTH / 2, y1: y + DIN_RAIL_WIDTH / 2 };
    /*
      直付けの機器（PLC のベースなど）もレールの切れ目。レールの帯（35mm）に掛かる
      直付け機器の上をレールが貫くと、実物では機器の下にレールが潜ることになり組めない。
      その機器の両側で別々のレールにする（ストッパもそれぞれの端に付く）。
    */
    const directBlocks = layout.placed
      .filter((p) => p.mount === 'direct')
      .flatMap((p) => {
        const spec = devices.get(p.specId);
        if (!spec) return [];
        const s = rotatedSize(spec.size, p.rot);
        return p.y < band.y1 && band.y0 < p.y + s.h ? [{ x0: p.x, x1: p.x + s.w }] : [];
      });
    const cuts = [
      ...layout.ducts
        .filter((d) => !d.removed && d.y < band.y1 && band.y0 < d.y + d.h)
        .map((d) => ({ x0: d.x, x1: d.x + d.w })),
      ...directBlocks,
      /*
        独立レールも切れ目にする。同じ高さに共通レールが通ると、レールの上にレールが
        乗ることになって実物では組めない。共通レールの側が譲る（独立レールは1台ぶんしか
        無いので、動かせるのは共通レールのほう）。
      */
      ...solo.filter((r) => sameBand(r.y, y)).map((r) => ({ x0: r.x, x1: r.x + r.length })),
    ].sort((a, b) => a.x0 - b.x0);

    const sorted = [...inRow].sort((a, b) => a.p.x - b.p.x);
    const groups: (typeof inRow)[] = [];
    for (const e of sorted) {
      const g = groups[groups.length - 1];
      const gRight = g
        ? Math.max(...g.map((q) => q.p.x + rotatedSize(q.spec.size, q.p.rot).w))
        : 0;
      const split = g && cuts.some((c) => c.x0 >= gRight - 0.01 && c.x1 <= e.p.x + 0.01);
      if (!g || split) groups.push([e]);
      else g.push(e);
    }

    let groupNo = 0;
    for (const g of groups) {
      const devLeft = Math.min(...g.map((e) => e.p.x));
      const devRight = Math.max(...g.map((e) => e.p.x + rotatedSize(e.spec.size, e.p.rot).w));
      const limitLeft = Math.max(0, ...cuts.filter((c) => c.x1 <= devLeft + 0.01).map((c) => c.x1));
      const limitRight = Math.min(
        Infinity,
        ...cuts.filter((c) => c.x0 >= devRight - 0.01).map((c) => c.x0),
      );
      /*
        手直し（図の上で端を矢印キーで動かしたぶん）は余長に足す。
        縮めるのは機器の端まで、伸ばすのは切れ目まで。範囲を越えた控えはここで丸める
        （機器を動かしたあとに控えが効きすぎないように）
      */
      const key = `${row.index}:${groupNo++}`;
      const adj = adjust?.[key];
      /*
        面の外へは出さない。座標置きの機器を面の端まで寄せると、余長のぶんレールが
        面からはみ出して描かれ、切断長も実物より長く数えていた
      */
      const faceRight = layout.size?.w ?? Infinity;
      const bounds = {
        left: { min: Math.min(limitLeft, devLeft), max: devLeft },
        right: { min: devRight, max: Math.max(Math.min(limitRight, faceRight), devRight) },
      };
      const left = Math.max(bounds.left.min, Math.min(bounds.left.max, devLeft - endMargin - (adj?.left ?? 0)));
      const right = Math.min(bounds.right.max, Math.max(bounds.right.min, devRight + endMargin + (adj?.right ?? 0)));
      /*
        機器のあいだに独立レールが挟まっているときは、切れ目で分けきれないことがある
        （余長どうしが噛み合って「間に収まる」と読めない場合）。最後に差し引いて、
        レールの上にレールが乗った図が残らないようにする。
      */
      /*
        ただし、**この段の機器の下を通る切れ目では切らない**。機器の下のレールを削ると、その機器が
        レールに乗っていない図になる。上下に少し動かした機器の独立レールが隣の機器の下に掛かるのが
        その例で、以前はそこで共通レールが切り刻まれて隣の機器のレールが消えていた。
        重なったレールそのものは検査（railOverlaps）で知らせる
      */
      // 止め金具は数えない。独立レールの隣に付けた止め金具は、そのレールの端を押さえるクリップで、
      // 共通レールと独立レールの継ぎ目に跨るのが正しい姿
      const underDevice = (c: { x0: number; x1: number }) =>
        g.some((e) => !isStopper(e.spec) && c.x0 < e.p.x + rotatedSize(e.spec.size, e.p.rot).w - 0.01 && e.p.x + 0.01 < c.x1);
      const pieces = subtractSpans(
        { x0: left, x1: right },
        [
          ...solo.filter((r) => sameBand(r.y, y)).map((r) => ({ x0: r.x, x1: r.x + r.length })),
          // 直付け機器の上も同じ。余長が機器に掛かったぶんは切り落とす
          ...directBlocks,
        ].filter((c) => !underDevice(c)),
      );
      for (const q of pieces) out.push({ row: row.index, x: q.x0, y, length: q.x1 - q.x0, key, bounds });
    }
  }

  return [...out, ...solo];
}

/**
 * 同じ高さで接している・重なっているレールを1本にまとめる（配列をその場で書き換える）。
 * 並べて置いた機器は1本のレールに乗るので、切断長も固定穴もエンドストッパも1本ぶん。
 */
export function mergeTouching(runs: RailRun[]): void {
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < runs.length - 1; ) {
    const a = runs[i]!;
    const b = runs[i + 1]!;
    // 接している（端どうしがぴったり）ぶんまで含めたいので、わずかな隙間は許す
    if (Math.abs(a.y - b.y) < 0.01 && b.x <= a.x + a.length + 0.01) {
      const right = Math.max(a.x + a.length, b.x + b.length);
      a.length = right - a.x;
      runs.splice(i + 1, 1);
      continue;
    }
    i++;
  }
}

/** 区間から区間を差し引く。残った断片を左から返す。 */
export function subtractSpans(
  span: { x0: number; x1: number },
  cut: { x0: number; x1: number }[],
): { x0: number; x1: number }[] {
  let pieces = [span];
  for (const c of cut) {
    const next: { x0: number; x1: number }[] = [];
    for (const p of pieces) {
      if (c.x1 <= p.x0 || c.x0 >= p.x1) {
        next.push(p);
        continue;
      }
      if (c.x0 > p.x0) next.push({ x0: p.x0, x1: c.x0 });
      if (c.x1 < p.x1) next.push({ x0: c.x1, x1: p.x1 });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.x1 - p.x0 > 0.01);
}
