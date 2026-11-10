/** 配置の検査。重なり・ダクトとの干渉・ベースユニットのスロット・奥行き。 */
import { DIN_RAIL_WIDTH } from '../../data/enclosures';
import { baseSlots, rotatedSize, slotUseOf } from '../../types';
import type { DeviceSpec, Duct, FaceId, PanelSpec, PlacedDevice, Violation } from '../../types';
import { deviceProjection, effectiveDepth } from './clearance';
import type { RailRun } from './rails';
import type { DeviceLookup } from './types';

/** 機器同士が実際に重なっていないか。手動配置で干渉させたときに気づけるようにする。 */
export function detectOverlaps(placed: PlacedDevice[], devices: DeviceLookup): Violation[] {
  const out: Violation[] = [];
  const rects = placed
    .map((p) => ({ p, spec: devices.get(p.specId) }))
    .filter((r): r is { p: PlacedDevice; spec: DeviceSpec } => Boolean(r.spec));

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const sa = rotatedSize(a.spec.size, a.p.rot);
      const sb = rotatedSize(b.spec.size, b.p.rot);
      const hit =
        a.p.x < b.p.x + sb.w && b.p.x < a.p.x + sa.w && a.p.y < b.p.y + sb.h && b.p.y < a.p.y + sa.h;
      if (hit) {
        out.push({
          uid: a.p.uid,
          kind: 'overlap',
          message: `${a.spec.model} と ${b.spec.model} が重なっています`,
        });
      }
    }
  }
  return out;
}

/**
 * 機器とダクトの干渉。
 *
 * 段割りに乗っている機器は構造上ダクトに重ならないが、
 * - 段の高さ equal モードで段を名指しされた背の高い機器（AI の段指定を含む）
 * - Shift ドラッグで手動固定した機器
 * はダクトへ食い込める。物理的にダクトの上に機器は付かないので、必ず知らせる。
 */
export function ductOverlaps(placed: PlacedDevice[], ducts: Duct[], devices: DeviceLookup): Violation[] {
  const out: Violation[] = [];
  const pen = 0.5; // 接している程度は見逃す
  for (const p of placed) {
    const spec = devices.get(p.specId);
    if (!spec) continue;
    const s = rotatedSize(spec.size, p.rot);
    for (const d of ducts) {
      if (d.removed) continue;
      const hit =
        p.x < d.x + d.w - pen &&
        d.x < p.x + s.w - pen &&
        p.y < d.y + d.h - pen &&
        d.y < p.y + s.h - pen;
      if (!hit) continue;
      const vert = d.h > d.w;
      const off = p.mount === 'din' ? (spec.dinOffset ?? 0) : 0;
      out.push({
        uid: p.uid,
        kind: 'overlap',
        message:
          `${spec.model}: ${vert ? '縦' : '横'}ダクトに重なっています（${vert ? '左右' : '上下'}方向の干渉）` +
          (p.pinned
            ? '。手で置いた位置がダクトに掛かっています'
            : `。高さ ${s.h}mm${off !== 0 ? `＋DINオフセット ${Math.abs(off)}mm（${off > 0 ? '上' : '下'}へ）` : ''} が段に入っていません` +
              '（段の高さを「自動」にするか、段数・盤サイズを見直してください）'),
      });
      break; // 1台につき1件で十分
    }
  }
  return out;
}

/**
 * ベースユニットに載せたユニットの検査。
 *
 * ポート数（スロット数）を超えて差せないのは実物と同じ。図の上では並んで見えて
 * しまうので、必ず知らせる。ベースの端からはみ出す場合も同じ。
 */
export function baseUnitViolations(placed: PlacedDevice[], devices: DeviceLookup): Violation[] {
  const out: Violation[] = [];
  for (const p of placed) {
    const spec = devices.get(p.specId);
    const base = spec?.baseUnit;
    if (!spec || !base) continue;
    const units = (p.opts ?? []).map((id) => devices.get(id));
    const used = units.reduce((n, u) => n + slotUseOf(u), 0);
    if (used > base.slots) {
      out.push({
        uid: p.uid,
        kind: 'overflow',
        message: `${spec.model}: スロットが足りません（ポート数 ${base.slots} に対して ${used} 使用）`,
      });
      continue;
    }
    const cells = baseSlots(
      base,
      units.map((u) => ({ w: u?.size.w ?? 0, h: u?.size.h ?? 0, slot: slotUseOf(u) })),
    );
    const right = Math.max(0, ...cells.map((c) => c.x + c.w));
    if (right > spec.size.w + 0.01) {
      out.push({
        uid: p.uid,
        kind: 'overflow',
        message:
          `${spec.model}: 載せたユニットがベースからはみ出します` +
          `（幅 ${spec.size.w}mm に対して ${Math.round(right * 10) / 10}mm）`,
      });
    }
  }
  return out;
}

/**
 * DINレールどうしの重なり。
 *
 * 帯（35mm）が上下に重なり、左右にも掛かる 2 本は同じ場所に付けられない。
 * 起きるのは、座標置きの DIN 機器をレールの帯の外ぎりぎり（18〜34mm）まで上下に動かして
 * 独立レールになり、それが段の共通レールに掛かったとき。機器の側を名指しして知らせる
 */
export function railOverlaps(rails: RailRun[], devices: DeviceLookup, placed: PlacedDevice[]): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const a of rails) {
    if (!a.solo || !a.uid || seen.has(a.uid)) continue;
    for (const b of rails) {
      if (a === b) continue;
      if (Math.abs(a.y - b.y) >= DIN_RAIL_WIDTH) continue;
      if (a.x + a.length <= b.x + 0.01 || b.x + b.length <= a.x + 0.01) continue;
      const spec = devices.get(placed.find((p) => p.uid === a.uid)?.specId ?? '');
      out.push({
        uid: a.uid,
        kind: 'overlap',
        message: `${spec?.model ?? a.uid}: DINレールが他のレールに重なっています（上下の位置をレール 1 本ぶん以上離すか、元の段のレールの高さに戻してください）`,
      });
      seen.add(a.uid);
      break;
    }
  }
  return out;
}

/** 面ごとの奥行きチェック。面によって当たる相手が違う。 */
export function depthViolations(
  panel: PanelSpec,
  face: FaceId,
  placed: PlacedDevice[],
  devices: DeviceLookup,
): Violation[] {
  const out: Violation[] = [];
  for (const p of placed) {
    const spec = devices.get(p.specId);
    if (!spec) continue;

    if (face === 'plate') {
      // 中板の機器は扉内面に当たらないか。内訳が未入力なら判定しない（当たり判定の根拠が無い）
      const limit = effectiveDepth(panel);
      /*
       * OP（アタッチメント等）は機器の下に挟まるので、その厚みぶん突出が増える。
       * ただし**ベースユニットに載せたユニットは横に並ぶ**ので厚みは足し算にならない。
       * ベース面から出るのはいちばん厚いユニット1台ぶん。
       */
      const optDs = (p.opts ?? []).map((id) => devices.get(id)?.size.d ?? 0);
      const optD = spec.baseUnit
        ? Math.max(0, ...optDs)
        : optDs.reduce((sum, d) => sum + d, 0);
      const projection = deviceProjection(spec, p.mount) + optD;
      if (limit !== null && projection > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message:
            `${spec.model}: 突出 ${projection}mm` +
            (optD > 0 ? `（${spec.baseUnit ? 'ユニット' : 'OP'} ${optD}mm 込み）` : '') +
            ` が有効奥行き ${limit}mm を超えています`,
        });
      }
    } else if (face === 'door' && p.side === 'in') {
      // 扉の内側に付けた機器は、扉と中板のあいだ（有効奥行き）に収まっているか
      const limit = effectiveDepth(panel);
      if (limit !== null && spec.size.d > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message: `${spec.model}: 扉の内側へ ${spec.size.d}mm 出て、有効奥行き ${limit}mm を超えています（中板の機器に当たります）`,
        });
      }
    } else if (face === 'door') {
      // 扉の機器は「扉裏の突出量」の設定に収まっているか
      const limit = panel.depth.doorProjection;
      if (limit !== null && spec.size.d > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message: `${spec.model}: 扉裏へ ${spec.size.d}mm 出ますが、設定は ${limit}mm です。奥行き設定を見直してください`,
        });
      }
    }
  }
  return out;
}
