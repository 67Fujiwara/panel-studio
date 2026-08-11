import type { DeviceSpec } from '../types';

/**
 * 機器マスタのサンプルデータ。
 *
 * ⚠ 寸法・発熱量はいずれも「仮値」です。実案件で使う前に、必ずメーカーの
 *    カタログ／N-TEC の図面データで実寸を確認して差し替えてください。
 *    ここに置いてあるのは、レイアウトエンジンと BOM の動作確認用です。
 *
 * ⚠ メーカー配布の DXF/DWG そのものは再配布が禁止されているため、
 *    このリポジトリには数値（寸法）だけを持ちます。図面ファイルは同梱しません。
 */
export const SAMPLE_DEVICES: DeviceSpec[] = [
  {
    id: 'mccb-3p-60a',
    maker: '三菱電機',
    model: 'NF63-SV 3P 60A',
    name: '配線用遮断器',
    category: 'breaker',
    size: { w: 75, h: 130, d: 68 },
    mount: ['din', 'plate'],
    clearance: { top: 20, bottom: 20 },
    heatW: 6,
  },
  {
    id: 'elcb-3p-30a',
    maker: '三菱電機',
    model: 'NV63-SV 3P 30A',
    name: '漏電遮断器',
    category: 'breaker',
    size: { w: 75, h: 130, d: 68 },
    mount: ['din', 'plate'],
    clearance: { top: 20, bottom: 20 },
    heatW: 5,
  },
  {
    id: 'mcb-2p-10a',
    maker: '三菱電機',
    model: 'NF32-SV 2P 10A',
    name: '配線用遮断器（制御用）',
    category: 'breaker',
    size: { w: 50, h: 110, d: 68 },
    mount: ['din', 'plate'],
    heatW: 2,
  },
  {
    id: 'contactor-st12',
    maker: '三菱電機',
    model: 'S-T12',
    name: '電磁接触器',
    category: 'contactor',
    size: { w: 45, h: 80, d: 78 },
    mount: ['din', 'plate'],
    clearance: { top: 10, bottom: 10 },
    heatW: 4,
  },
  {
    id: 'contactor-st20',
    maker: '三菱電機',
    model: 'S-T20',
    name: '電磁接触器',
    category: 'contactor',
    size: { w: 52, h: 90, d: 86 },
    mount: ['din', 'plate'],
    clearance: { top: 10, bottom: 10 },
    heatW: 6,
  },
  {
    id: 'relay-my2n',
    maker: 'オムロン',
    model: 'MY2N-D2 + PYF08A',
    name: 'ミニチュアリレー（ソケット付）',
    category: 'relay',
    size: { w: 21, h: 55, d: 60 },
    mount: ['din'],
    heatW: 1,
  },
  {
    id: 'relay-g7t',
    maker: 'オムロン',
    model: 'G7T-1122S',
    name: 'I/Oリレー',
    category: 'relay',
    size: { w: 12, h: 50, d: 55 },
    mount: ['din'],
    heatW: 0.5,
  },
  {
    id: 'plc-fx5u-32',
    maker: '三菱電機',
    model: 'FX5U-32MT/ES',
    name: 'PLC 基本ユニット',
    category: 'plc',
    size: { w: 150, h: 90, d: 83 },
    mount: ['din', 'plate'],
    clearance: { top: 50, bottom: 50, left: 20, right: 20 },
    heatW: 12,
  },
  {
    id: 'plc-fx5-16ex',
    maker: '三菱電機',
    model: 'FX5-16EX/ES',
    name: 'PLC 増設入力ユニット',
    category: 'plc',
    size: { w: 40, h: 90, d: 83 },
    mount: ['din', 'plate'],
    clearance: { top: 50, bottom: 50 },
    heatW: 3,
  },
  {
    id: 'psu-24v-5a',
    maker: 'オムロン',
    model: 'S8VK-C12024',
    name: 'スイッチング電源 DC24V 5A',
    category: 'psu',
    size: { w: 40, h: 125, d: 100 },
    mount: ['din'],
    clearance: { top: 50, bottom: 30, left: 15, right: 15 },
    heatW: 15,
  },
  {
    id: 'psu-24v-10a',
    maker: 'TDKラムダ',
    model: 'DRB120-24-1',
    name: 'スイッチング電源 DC24V 10A',
    category: 'psu',
    size: { w: 60, h: 125, d: 110 },
    mount: ['din'],
    clearance: { top: 50, bottom: 30, left: 20, right: 20 },
    heatW: 24,
  },
  {
    id: 'terminal-ut4',
    maker: 'フェニックス・コンタクト',
    model: 'UT 4',
    name: 'ねじ式端子台 4mm²',
    category: 'terminal',
    size: { w: 6.2, h: 60, d: 47 },
    mount: ['din'],
  },
  {
    id: 'terminal-ut25',
    maker: 'フェニックス・コンタクト',
    model: 'UT 2.5',
    name: 'ねじ式端子台 2.5mm²',
    category: 'terminal',
    size: { w: 5.2, h: 55, d: 47 },
    mount: ['din'],
  },
  {
    id: 'terminal-end',
    maker: 'フェニックス・コンタクト',
    model: 'CLIPFIX 35',
    name: 'エンドストッパ',
    category: 'other',
    size: { w: 9.5, h: 35, d: 30 },
    mount: ['din'],
  },
];

export const DEVICE_BY_ID = new Map(SAMPLE_DEVICES.map((d) => [d.id, d]));

export const CATEGORY_LABEL: Record<DeviceSpec['category'], string> = {
  breaker: 'ブレーカ',
  contactor: '電磁接触器',
  relay: 'リレー',
  plc: 'PLC',
  psu: '電源',
  terminal: '端子台',
  other: 'その他',
};

export const CATEGORY_COLOR: Record<DeviceSpec['category'], string> = {
  breaker: '#4f6bed',
  contactor: '#2f9e79',
  relay: '#c9762a',
  plc: '#8258c8',
  psu: '#c0433f',
  terminal: '#5a6470',
  other: '#7d8894',
};
