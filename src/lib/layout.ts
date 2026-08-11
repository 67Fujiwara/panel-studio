import { DIN_RAIL_HEIGHT } from '../data/enclosures';
import { DEVICE_BY_ID } from '../data/devices';
import type {
  ClearanceSettings,
  DeviceRow,
  DeviceSpec,
  DuctSettings,
  LayoutResult,
  PanelSpec,
  PlacedDevice,
  Profile,
  Rect,
  Sides,
  Violation,
} from '../types';

/** 発熱機器とみなすしきい値(W)。これを超えると上下に追加離隔を取る。 */
const HEAT_THRESHOLD_W = 10;

/**
 * 実効クリアランス = max(グローバル設定, 機器個別のメーカー指定値)。
 * メーカー指定を下回らせないのが狙い。
 *
 * 上下はダクトが相手なので deviceToDuct を下限にする。
 * 左右は隣の機器が相手なので、ここではメーカー指定値だけを返し、
 * 機器同士の間隔は呼び出し側で deviceToDevice.sameRow と突き合わせる。
 * （端子台のように横に密着させる機器で、ダクト用の余白を挟んでしまうのを防ぐ）
 */
export function effectiveClearance(spec: DeviceSpec, c: ClearanceSettings): Sides {
  const s = spec.clearance ?? {};
  const heat = (spec.heatW ?? 0) >= HEAT_THRESHOLD_W ? c.heatExtra : 0;
  // heat は「下限」として効かせる。メーカー指定値に足し込むと、
  // 既に発熱を見込んだ指定値に二重で上乗せしてしまうため。
  return {
    top: Math.max(c.deviceToDuct.top, s.top ?? 0, heat),
    bottom: Math.max(c.deviceToDuct.bottom, s.bottom ?? 0, heat),
    left: s.left ?? 0,
    right: s.right ?? 0,
  };
}

/** 中板上面から扉内面までの有効奥行き。ここに収まらない機器は扉に当たる。 */
export function effectiveDepth(panel: PanelSpec): number {
  return panel.depth.outer - panel.depth.backToPlate - panel.depth.doorProjection;
}

/** 取付方式込みの機器の突出量。 */
export function deviceProjection(spec: DeviceSpec, mount: PlacedDevice['mount']): number {
  return spec.size.d + (mount === 'din' ? DIN_RAIL_HEIGHT : 0);
}

/**
 * ダクトと機器行の割り付け。rows は上から順（index 0 が最上段）。
 * v1 は横ダクト段組みを基準に組み、他パターンはここを差し替えて増やす。
 */
export function computeRows(
  panel: PanelSpec,
  duct: DuctSettings,
): { rows: DeviceRow[]; ducts: Rect[]; error?: string } {
  const { w, h } = panel.plate;
  const { margin, width: dw, rowCount: n } = duct;

  const usableH = h - margin.top - margin.bottom;
  const rowH = (usableH - (n + 1) * dw) / n;

  const x = margin.left;
  const ductW = w - margin.left - margin.right;

  if (n < 1 || rowH <= 0 || ductW <= 0) {
    return {
      rows: [],
      ducts: [],
      error: '中板に対してダクト幅・段数・余白が大きすぎます。設定を見直してください。',
    };
  }

  const rows: DeviceRow[] = [];
  const ducts: Rect[] = [];

  for (let i = 0; i < n; i++) {
    const y = h - margin.top - (i + 1) * (dw + rowH);
    rows.push({ index: i, y, h: rowH });
    // 各機器行の上に1本
    ducts.push({ x, y: y + rowH, w: ductW, h: dw });
  }
  // 最下段の下にもう1本
  ducts.push({ x, y: margin.bottom, w: ductW, h: dw });

  return { rows, ducts };
}

/** 上段から順に埋めるためのカテゴリ優先度。端子台を最後にして下段に落とす。 */
const CATEGORY_ORDER: DeviceSpec['category'][] = [
  'breaker',
  'contactor',
  'relay',
  'plc',
  'psu',
  'other',
  'terminal',
];

export type LayoutItem = { uid: string; specId: string; mount: PlacedDevice['mount'] };

/**
 * 自動配置。
 *
 * 最適化（2Dビンパッキング）はあえて行わない。実務で求められているのは
 * 「隙間なく詰める」ことではなく「主幹は上段、端子台は下段」といった
 * 人間のルールどおりに並ぶことで、最適解は見た目が常識から外れて使われなくなる。
 *
 * pinned（人が手で動かした機器）は座標を保持する。これにより機器を1台足しても
 * 既存の配置が組み替わらない。
 */
export function autoLayout(
  panel: PanelSpec,
  profile: Profile,
  items: LayoutItem[],
  previous: PlacedDevice[] = [],
): LayoutResult {
  const { rows, ducts, error } = computeRows(panel, profile.duct);
  const violations: Violation[] = [];

  if (error) {
    return { rows, ducts, placed: [], violations: [{ uid: '', kind: 'overflow', message: error }] };
  }

  const c = profile.clearance;
  const pinnedByUid = new Map(previous.filter((p) => p.pinned).map((p) => [p.uid, p]));

  const xMin = Math.max(profile.duct.margin.left, c.deviceToPlateEdge);
  const xMax = panel.plate.w - Math.max(profile.duct.margin.right, c.deviceToPlateEdge);

  const placed: PlacedDevice[] = [];
  // 行ごとの「次に置ける X」と「直前の機器の右クリアランス」
  const cursor = rows.map(() => xMin);
  const prevRight = rows.map(() => 0);

  // pinned は先に確定させ、その行のカーソルを進めておく
  for (const item of items) {
    const pin = pinnedByUid.get(item.uid);
    const spec = DEVICE_BY_ID.get(item.specId);
    if (!pin || !spec) continue;
    placed.push(pin);
    const eff = effectiveClearance(spec, c);
    const row = pin.row;
    if (cursor[row] !== undefined) {
      cursor[row] = Math.max(cursor[row]!, pin.x + spec.size.w);
      prevRight[row] = eff.right;
    }
  }

  const queue = items
    .filter((i) => !pinnedByUid.has(i.uid))
    .map((i) => ({ item: i, spec: DEVICE_BY_ID.get(i.specId) }))
    .filter((e): e is { item: LayoutItem; spec: DeviceSpec } => Boolean(e.spec))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.spec.category) - CATEGORY_ORDER.indexOf(b.spec.category));

  const depthLimit = effectiveDepth(panel);
  let row = 0;

  for (const { item, spec } of queue) {
    const eff = effectiveClearance(spec, c);

    // 奥行き方向の干渉チェック（扉裏に当たらないか）
    const projection = deviceProjection(spec, item.mount);
    if (projection > depthLimit) {
      violations.push({
        uid: item.uid,
        kind: 'depth',
        message: `${spec.model}: 突出 ${projection}mm が有効奥行き ${depthLimit}mm を超えています`,
      });
    }

    // 上段から順に探す。row は「使い切った行」の先頭を指す共有カーソルで、
    // 幅を使い切ったときだけ前進させる。行の高さが足りないだけの場合は
    // その行を他の機器がまだ使えるので、row は動かさずローカルに次を見る。
    let target = -1;
    let tooShort = false;
    for (let r = row; r < rows.length; r++) {
      const rr = rows[r]!;
      if (spec.size.h + eff.top + eff.bottom > rr.h) {
        tooShort = true;
        continue;
      }
      const gap = Math.max(prevRight[r] ?? 0, eff.left, c.deviceToDevice.sameRow);
      const startX = cursor[r] === xMin ? xMin : (cursor[r] ?? xMin) + gap;

      if (startX + spec.size.w <= xMax) {
        placed.push({
          uid: item.uid,
          specId: item.specId,
          mount: item.mount,
          x: startX,
          y: rr.y + eff.bottom,
          row: r,
          pinned: false,
        });
        cursor[r] = startX + spec.size.w;
        prevRight[r] = eff.right;
        target = r;
        break;
      }
      // この行は幅を使い切った
      if (r === row) row++;
    }

    if (target < 0) {
      violations.push({
        uid: item.uid,
        kind: tooShort ? 'clearance' : 'overflow',
        message: tooShort
          ? `${spec.model}: 高さ ${spec.size.h}mm ＋ クリアランスが機器行の高さに収まりません（段数を減らすか盤を大きく）`
          : `${spec.model}: 横幅が足りません（盤を大きくするか段数を増やしてください）`,
      });
    }
  }

  return { rows, ducts, placed, violations };
}
