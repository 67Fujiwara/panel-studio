/**
 * 配置計算の「答え合わせ」。機器の組み合わせごとに autoLayout と computeRails の結果を
 * スナップショットに残し、リファクタリングで数値が 1 つでも変わったら落ちるようにする。
 *
 * 意図して動きを変えるときだけ `npx vitest run -u` で更新する。
 * その場合は、なぜ変わったかをコミットメッセージに書くこと。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICES } from '../../src/data/devices';
import { autoLayout, computeRails } from '../../src/lib/layout';
import type { DeviceLookup, LayoutItem } from '../../src/lib/layout';
import type { DeviceSpec, FaceId, LayoutResult, PlacedDevice, Profile } from '../../src/types';
import { panel, profile } from './helpers';

/** 追加の部品: 独立レール取付のインバータ、オフセット付きのリレー、PLC ベースとユニット */
const EXTRA: DeviceSpec[] = [
  {
    id: 'inv-solo',
    maker: 'テスト',
    model: 'INV-SOLO',
    name: 'インバータ（独立レール）',
    category: 'other',
    size: { w: 70, h: 140, d: 120 },
    mount: ['din-solo'],
    dinOffset: 10,
    heatW: 25,
  },
  {
    id: 'relay-off',
    maker: 'テスト',
    model: 'RLY-OFF',
    name: 'リレー（オフセット）',
    category: 'relay',
    size: { w: 30, h: 70, d: 60 },
    mount: ['din'],
    dinOffset: -12,
  },
  {
    id: 'plc-base',
    maker: 'テスト',
    model: 'R35B',
    name: 'ベースユニット 5 スロット',
    category: 'plc',
    size: { w: 245, h: 106, d: 30 },
    mount: ['direct'],
    baseUnit: { slots: 5, offset: 20, pitch: 0, bottom: 0 },
  },
  {
    id: 'plc-cpu',
    maker: 'テスト',
    model: 'R08CPU',
    name: 'CPU',
    category: 'plc',
    size: { w: 27.8, h: 106, d: 110 },
    mount: ['direct'],
    slotUse: 0,
  },
  {
    id: 'plc-io',
    maker: 'テスト',
    model: 'RX40C7',
    name: '入力',
    category: 'plc',
    size: { w: 27.8, h: 106, d: 110 },
    mount: ['direct'],
    slotUse: 1,
  },
];

const devices: DeviceLookup = new Map([...DEFAULT_DEVICES, ...EXTRA].map((d) => [d.id, d]));

let seq = 0;
const item = (specId: string, extra: Partial<LayoutItem> = {}, face: FaceId = 'plate'): LayoutItem => ({
  uid: `${specId}#${seq++}`,
  specId,
  face,
  mount: devices.get(specId)!.mount[0]!,
  ...extra,
});
const many = (specId: string, n: number, extra: Partial<LayoutItem> = {}) =>
  Array.from({ length: n }, () => item(specId, extra));

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** スナップショットに残す形。順番と丸めを固定して、見比べられるようにする */
function snap(lay: LayoutResult, rails = computeRails(lay, devices, 20)) {
  return {
    rows: lay.rows.map((r) => ({ index: r.index, y: r3(r.y), h: r3(r.h), axis: r.axis === undefined ? undefined : r3(r.axis) })),
    ducts: lay.ducts.map((d) => ({ id: d.id, vert: d.vert, x: r3(d.x), y: r3(d.y), w: r3(d.w), h: r3(d.h), removed: d.removed })),
    placed: [...lay.placed]
      .sort((a, b) => a.uid.localeCompare(b.uid))
      .map((p) => ({ uid: p.uid, x: r3(p.x), y: r3(p.y), row: p.row, mount: p.mount, rot: p.rot ?? 0, pinned: p.pinned, onRail: p.onRail })),
    violations: lay.violations.map((v) => ({ uid: v.uid, kind: v.kind, message: v.message })),
    rails: rails.map((r) => ({ row: r.row, x: r3(r.x), y: r3(r.y), length: r3(r.length), solo: r.solo, key: r.key })),
  };
}

/** 奥行きの内訳を入れた盤。有効奥行き = 200 − 40 − 60 = 100mm（電源 d100 ＋レール 7.5 は当たる） */
function withDepth() {
  const p = panel();
  p.depth = { backToPlate: 40, doorProjection: 60 };
  return p;
}

describe('配置計算の答え合わせ（組み合わせ）', () => {
  it('A: 典型的な中板（遮断器・接触器・PLC・電源・端子台・止め金具）', () => {
    seq = 0;
    const items = [
      ...many('mccb-3p-60a', 2),
      ...many('contactor-st12', 4),
      item('plc-fx5u-32'),
      item('psu-24v-5a'),
      ...many('terminal-ut25', 20),
      ...many('terminal-end', 2),
    ];
    const lay = autoLayout(withDepth(), profile(), 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('B: 座標置き（レール上・レール外・直付け）とダクトの余白・消したダクト', () => {
    seq = 0;
    const items = [
      ...many('mccb-3p-60a', 2),
      ...many('contactor-st12', 3),
      ...many('terminal-ut25', 12),
      ...many('relay-my2n', 4),
    ];
    const prof = profile();
    prof.duct.ductGaps = { 1: { above: 30, below: 25, left: 10, right: 40 }, 2: { above: 20 } };
    // 1 回目で段の位置を知り、2 回目で座標置きを足す
    const first = autoLayout(withDepth(), prof, 'plate', items, [], devices, []);
    const tb = first.placed.find((p) => p.specId === 'terminal-ut25')!;
    const rly = first.placed.find((p) => p.specId === 'relay-my2n')!;
    const pinned: PlacedDevice[] = [
      // レールに乗ったまま右へ寄せた端子台
      { ...tb, x: 300, pinned: true, onRail: true },
      // レールから外して上へ動かしたリレー（独立レールになる）
      { ...rly, x: rly.x + 40, y: rly.y + 60, pinned: true, onRail: false },
      // 直付けの電源を座標で置く
      { uid: 'psu-24v-10a#pin', specId: 'psu-24v-10a', face: 'plate', mount: 'direct', x: 380, y: 420, row: -1, pinned: true },
    ];
    const all = [...items, { uid: 'psu-24v-10a#pin', specId: 'psu-24v-10a', face: 'plate' as const, mount: 'direct' as const }];
    const lay = autoLayout(withDepth(), prof, 'plate', all, pinned, devices, [3]);
    expect(snap(lay, computeRails(lay, devices, 20, { '0:0': { right: 15 } }))).toMatchSnapshot();
  });

  it('C: ゾーン分割（動力左・制御右）と区画の指定', () => {
    seq = 0;
    const prof = profile();
    prof.duct.layout = 'zoned';
    const items = [
      ...many('mccb-3p-60a', 2),
      ...many('contactor-st20', 3),
      item('plc-fx5u-32'),
      ...many('relay-g7t', 6),
      // 接触器 1 台を制御側へ
      item('contactor-st12', { zone: 1 }),
      ...many('terminal-ut4', 8),
    ];
    const lay = autoLayout(withDepth(), prof, 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('D: 全周囲い（perimeter）と田の字（cross）、縦ダクトのずらし', () => {
    seq = 0;
    const items = [...many('mccb-3p-60a', 1), ...many('contactor-st12', 2), ...many('terminal-ut25', 10)];
    const peri = profile();
    peri.duct.layout = 'perimeter';
    const cross = profile();
    cross.duct.layout = 'cross';
    cross.duct.vertGaps = { 1: { dx: 30 } };
    expect({
      perimeter: snap(autoLayout(withDepth(), peri, 'plate', items, [], devices, [])),
      cross: snap(autoLayout(withDepth(), cross, 'plate', items, [], devices, [])),
    }).toMatchSnapshot();
  });

  it('E: 端子台最下段（terminal-bottom）と段の指定', () => {
    seq = 0;
    const prof = profile();
    prof.duct.layout = 'terminal-bottom';
    const items = [
      ...many('terminal-ut25', 6),
      ...many('mccb-3p-60a', 2),
      item('contactor-st12', { row: 1 }),
      item('contactor-st12', { row: 1 }),
      ...many('terminal-ut4', 4),
    ];
    const lay = autoLayout(withDepth(), prof, 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('F: 段の高さ「全段そろえる」（equal）で段を名指し', () => {
    seq = 0;
    const prof: Profile = profile();
    prof.duct.rowHeightMode = 'equal';
    prof.duct.rowCount = 3;
    const items = [
      ...many('mccb-3p-60a', 2),
      item('plc-fx5u-32', { row: 1 }),
      ...many('terminal-ut25', 8, { row: 2 }),
      ...many('contactor-st12', 2),
    ];
    const lay = autoLayout(withDepth(), prof, 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('G: 独立レールの機器・オフセット付きリレー・止め金具の密着', () => {
    seq = 0;
    const items = [
      item('inv-solo'),
      item('terminal-end'),
      ...many('relay-off', 3),
      item('terminal-end'),
      item('inv-solo'),
      ...many('mccb-3p-60a', 1),
    ];
    const lay = autoLayout(withDepth(), profile(), 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('H: PLC ベースにユニットを載せる（スロット超過と奥行き）', () => {
    seq = 0;
    const items = [
      item('plc-base', { opts: ['plc-cpu', 'plc-io', 'plc-io', 'plc-io'] }),
      item('plc-base', { opts: ['plc-cpu', 'plc-io', 'plc-io', 'plc-io', 'plc-io', 'plc-io', 'plc-io'] }),
      ...many('terminal-ut25', 4),
    ];
    const lay = autoLayout(withDepth(), profile(), 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('I: 扉面（段が無い面）の座標置きと奥行き', () => {
    seq = 0;
    const items = [item('pb-a22', {}, 'door'), item('estop-a22', {}, 'door'), item('hmi-gt2107', {}, 'door'), item('pl-m22', { side: 'in' }, 'door')];
    const pinned: PlacedDevice[] = [
      { uid: items[2]!.uid, specId: 'hmi-gt2107', face: 'door', mount: 'direct', x: 200, y: 500, row: -1, pinned: true },
    ];
    const lay = autoLayout(withDepth(), profile(), 'door', items, pinned, devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });

  it('J: 段からあふれる量（端子台 120 台）と面に入り切らない高さ', () => {
    seq = 0;
    const items = [...many('terminal-ut25', 120), ...many('mccb-3p-60a', 6), ...many('psu-24v-10a', 4)];
    const lay = autoLayout(withDepth(), profile(), 'plate', items, [], devices, []);
    expect(snap(lay)).toMatchSnapshot();
  });
});
