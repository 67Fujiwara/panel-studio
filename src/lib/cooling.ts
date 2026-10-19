/**
 * ファン／盤クーラーの選定。
 *
 * 設置条件（壁・隣盤・天井で放熱面が減る）と環境、盤サイズ・材質、総発熱量、外気温と盤内目標温度から、
 * 自然放熱で足りるか・フィルターファンで足りるか・熱交換器かクーラーかを判定し、必要風量／必要能力を出す。
 * 式は docs/cooling-spec（盤ファン選定機能 実装仕様）のとおり。定数は設定画面で変えられる。
 */

export type CoolingMount =
  | 'single_free'
  | 'single_wall'
  | 'end_free'
  | 'end_wall'
  | 'middle_free'
  | 'middle_wall'
  | 'middle_wall_roof';
export type CoolingEnv = 'clean' | 'dust' | 'oil_water' | 'outdoor';
export type CoolingMaterial = 'steel' | 'stainless' | 'resin';
export type CoolingMethod = 'none' | 'fan' | 'heat_exchanger' | 'cooler';

/** 設定画面で変えられる定数 */
export type CoolingConsts = {
  /** 空気の熱特性係数 [m³·K/(W·h)]（標高 0〜100 m） */
  fAir: number;
  /** フィルター目詰まり・圧損の余裕率 */
  margin: number;
  /** これ未満の温度差 [K] はファン非推奨 */
  minDtFan: number;
};
export const DEFAULT_COOLING_CONSTS: CoolingConsts = { fAir: 3.1, margin: 1.3, minDtFan: 5 };

/** ウィザードの入力。mount / env は選ぶまで空 */
export type CoolingInput = {
  mount?: CoolingMount;
  env?: CoolingEnv;
  material: CoolingMaterial;
  wMm: number;
  hMm: number;
  dMm: number;
  /** 総発熱量 [W] */
  qv: number;
  /** 最高外気温 [℃] */
  ta: number;
  /** 盤内目標温度 [℃] */
  ti: number;
};

/** profile に持つ分。input は案件ごと、consts は決め事 */
export type CoolingSettings = { input?: Partial<CoolingInput>; consts?: Partial<CoolingConsts> };

export const DEFAULT_COOLING_INPUT: Omit<CoolingInput, 'mount' | 'env'> = {
  material: 'steel',
  wMm: 800,
  hMm: 1800,
  dMm: 400,
  qv: 0,
  ta: 35,
  ti: 40,
};

export type MountDef = {
  id: CoolingMount;
  label: string;
  desc: string;
  wall: boolean;
  /** 隣盤の数（0: なし、1: 片側、2: 両側） */
  neighbors: 0 | 1 | 2;
  roof: boolean;
  /** 有効放熱面積 [m²]。W・H・D は m */
  area: (W: number, H: number, D: number) => number;
  formula: string;
};

export const MOUNTS: MountDef[] = [
  { id: 'single_free', label: '単独・自立', desc: '壁から離して置く 1 面盤', wall: false, neighbors: 0, roof: false, area: (W, H, D) => 1.8 * H * (W + D) + 1.4 * W * D, formula: '1.8·H·(W+D) + 1.4·W·D' },
  { id: 'single_wall', label: '単独・背面壁', desc: '壁に背面をつけて置く 1 面盤', wall: true, neighbors: 0, roof: false, area: (W, H, D) => 1.4 * W * (H + D) + 1.8 * D * H, formula: '1.4·W·(H+D) + 1.8·D·H' },
  { id: 'end_free', label: '列盤の端・自立', desc: '列の端で、片側に隣の盤', wall: false, neighbors: 1, roof: false, area: (W, H, D) => 1.4 * D * (H + W) + 1.8 * W * H, formula: '1.4·D·(H+W) + 1.8·W·H' },
  { id: 'end_wall', label: '列盤の端・背面壁', desc: '列の端で、背面は壁', wall: true, neighbors: 1, roof: false, area: (W, H, D) => 1.4 * H * (W + D) + 1.4 * W * D, formula: '1.4·H·(W+D) + 1.4·W·D' },
  { id: 'middle_free', label: '列盤の中間・自立', desc: '両側に隣の盤、背面は空く', wall: false, neighbors: 2, roof: false, area: (W, H, D) => 1.8 * W * H + 1.4 * W * D + D * H, formula: '1.8·W·H + 1.4·W·D + D·H' },
  { id: 'middle_wall', label: '列盤の中間・背面壁', desc: '両側に隣の盤、背面は壁', wall: true, neighbors: 2, roof: false, area: (W, H, D) => 1.4 * W * (H + D) + D * H, formula: '1.4·W·(H+D) + D·H' },
  { id: 'middle_wall_roof', label: '列盤の中間・背面壁・天井ふさがり', desc: '両側に隣の盤、背面は壁、上もふさがる', wall: true, neighbors: 2, roof: true, area: (W, H, D) => 1.4 * W * H + 0.7 * W * D + D * H, formula: '1.4·W·H + 0.7·W·D + D·H' },
];

export type EnvDef = { id: CoolingEnv; label: string; desc: string; fanOk: boolean; note?: string };
export const ENVS: EnvDef[] = [
  { id: 'clean', label: '屋内・清浄', desc: '工場の屋内で空気がきれい', fanOk: true },
  { id: 'dust', label: '粉塵が多い', desc: '粉や粒が舞う', fanOk: false, note: '粉塵環境のため密閉できる熱交換器以上を推奨' },
  { id: 'oil_water', label: '油煙・水気あり', desc: 'ミスト・しずくがかかる', fanOk: false, note: '油煙・水気があるため密閉できる熱交換器以上を推奨' },
  { id: 'outdoor', label: '屋外', desc: '雨風・日射を受ける', fanOk: false, note: '屋外のため密閉できる熱交換器以上を推奨。日射で盤表面が温まるぶんは別途見込む' },
];

export type MaterialDef = { id: CoolingMaterial; label: string; k: number };
export const MATERIALS: MaterialDef[] = [
  { id: 'steel', label: '鋼板', k: 5.5 },
  { id: 'stainless', label: 'ステンレス', k: 4.5 },
  { id: 'resin', label: '樹脂', k: 3.5 },
];

export const METHOD_LABEL: Record<CoolingMethod, string> = {
  none: 'ファン不要',
  fan: 'フィルターファン',
  heat_exchanger: '熱交換器',
  cooler: '盤用クーラー',
};

export const MOUNT_BY_ID = new Map(MOUNTS.map((m) => [m.id, m]));
export const ENV_BY_ID = new Map(ENVS.map((e) => [e.id, e]));
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export function effectiveArea(mount: CoolingMount, W: number, H: number, D: number): number {
  return MOUNT_BY_ID.get(mount)!.area(W, H, D);
}

export function coolingConsts(partial?: Partial<CoolingConsts>): CoolingConsts {
  return { ...DEFAULT_COOLING_CONSTS, ...(partial ?? {}) };
}

/** 入力の範囲。外れていれば赤枠にして計算しない */
export const INPUT_RANGE: Record<'wMm' | 'hMm' | 'dMm' | 'qv' | 'ta' | 'ti', [number, number]> = {
  wMm: [100, 3000],
  hMm: [100, 3000],
  dMm: [100, 3000],
  qv: [0, 20000],
  ta: [-20, 60],
  ti: [0, 70],
};

export type CoolingCheck = {
  /** 計算できない理由（空なら計算できる） */
  errors: string[];
  /** 計算はするが注意すること */
  warnings: string[];
  /** 赤枠にする項目 */
  bad: Set<keyof CoolingInput>;
};

export function checkCoolingInput(i: Partial<CoolingInput>): CoolingCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bad = new Set<keyof CoolingInput>();
  const labels: Record<keyof typeof INPUT_RANGE, string> = { wMm: '幅 W', hMm: '高さ H', dMm: '奥行き D', qv: '総発熱量', ta: '最高外気温', ti: '盤内目標温度' };
  for (const key of Object.keys(INPUT_RANGE) as (keyof typeof INPUT_RANGE)[]) {
    const v = i[key];
    const [lo, hi] = INPUT_RANGE[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      bad.add(key);
      errors.push(`${labels[key]} は ${lo}〜${hi} の範囲で入れてください`);
    }
  }
  if (!i.mount) errors.push('設置条件を選んでください');
  if (!i.env) errors.push('設置環境を選んでください');
  if (typeof i.ta === 'number' && typeof i.ti === 'number') {
    const dT = i.ti - i.ta;
    if (dT <= 0) warnings.push('外気温が目標温度以上です。ファンでは冷やせません');
    else if (dT < 5) warnings.push('温度差が小さく、ファンの必要風量が大きくなります');
  }
  if (typeof i.ti === 'number' && i.ti > 55) warnings.push('目標温度が高すぎないか、機器の許容温度を確認してください');
  return { errors, warnings, bad };
}

export type CoolingResult = {
  /** 有効放熱面積 [m²] */
  A: number;
  /** 熱通過率 [W/(m²·K)] */
  k: number;
  /** 温度差 Ti − Ta [K] */
  dT: number;
  /** 自然放熱 [W]（dT ≤ 0 なら負＝外から熱が入る） */
  Qs: number;
  /** ファン等で逃がす熱 [W] */
  Qnet: number;
  method: CoolingMethod;
  /** 必要風量 [m³/h]（ファンのとき） */
  vh: number | null;
  /** 必要風量 [m³/min] */
  vmin: number | null;
  /** 選定風量 [m³/min]（余裕率を掛けた、フィルター付き実風量で比較する値） */
  selectVmin: number | null;
  /** 熱交換器の必要能力 [W/K] */
  hexCap: number | null;
  /** クーラーの必要冷却能力 [W] */
  coolerCap: number | null;
  /** 判定理由（一行） */
  reason: string;
};

export function coolingCalc(i: CoolingInput & { mount: CoolingMount; env: CoolingEnv }, c: CoolingConsts = DEFAULT_COOLING_CONSTS): CoolingResult {
  const W = i.wMm / 1000;
  const H = i.hMm / 1000;
  const D = i.dMm / 1000;
  const k = MATERIAL_BY_ID.get(i.material)?.k ?? MATERIALS[0]!.k;
  const dT = i.ti - i.ta;
  const A = effectiveArea(i.mount, W, H, D);
  const Qs = k * A * dT;
  const Qnet = i.qv - Qs;
  const env = ENV_BY_ID.get(i.env)!;

  let method: CoolingMethod;
  let vh: number | null = null;
  let hexCap: number | null = null;
  let coolerCap: number | null = null;
  let reason: string;
  if (dT > 0 && Qnet <= 0) {
    method = 'none';
    reason = `自然放熱 ${Qs.toFixed(1)} W が発熱 ${i.qv.toFixed(1)} W を上回るので、ファンは要りません`;
  } else if (dT < c.minDtFan) {
    method = 'cooler';
    // Ta ≥ Ti のときは盤表面から逆に熱が入る。Qs が負なので Qnet = Qv + k·A·(Ta − Ti) になっている
    coolerCap = Qnet;
    reason =
      dT <= 0
        ? '外気温が目標温度以上なので、ファン・熱交換器では冷やせません。盤用クーラーが要ります'
        : `温度差が ${c.minDtFan} K 未満でファンの風量が実用外になるため、盤用クーラーを推奨`;
  } else if (!env.fanOk) {
    method = 'heat_exchanger';
    hexCap = Qnet / dT;
    reason = env.note ?? '密閉できる熱交換器を推奨';
  } else {
    method = 'fan';
    vh = (c.fAir * Qnet) / dT;
    reason = '屋内の清浄な環境で温度差が取れるので、フィルターファンで足ります';
  }
  return {
    A,
    k,
    dT,
    Qs,
    Qnet,
    method,
    vh,
    vmin: vh === null ? null : vh / 60,
    selectVmin: vh === null ? null : (vh * c.margin) / 60,
    hexCap,
    coolerCap,
    reason,
  };
}

/** 入力が揃っていれば計算する。揃っていなければ null */
export function coolingResultOf(input: Partial<CoolingInput> | undefined, consts?: Partial<CoolingConsts>): CoolingResult | null {
  if (!input || !input.mount || !input.env) return null;
  const full = { ...DEFAULT_COOLING_INPUT, ...input } as CoolingInput & { mount: CoolingMount; env: CoolingEnv };
  if (checkCoolingInput(full).errors.length > 0) return null;
  return coolingCalc(full, coolingConsts(consts));
}

/** 結果の一行表示。設計完了画面の発熱の横に出す */
export function coolingSummary(r: CoolingResult): string {
  switch (r.method) {
    case 'none':
      return `ファン不要（自然放熱の余裕 ${(-r.Qnet).toFixed(1)} W）`;
    case 'fan':
      return `フィルターファン 選定風量 ${r.selectVmin!.toFixed(2)} m³/min（計算 ${r.vh!.toFixed(1)} m³/h）`;
    case 'heat_exchanger':
      return `熱交換器 必要能力 ${r.hexCap!.toFixed(1)} W/K（逃がす熱 ${r.Qnet.toFixed(1)} W）`;
    case 'cooler':
      return `盤用クーラー 必要冷却能力 ${r.coolerCap!.toFixed(1)} W`;
  }
}
