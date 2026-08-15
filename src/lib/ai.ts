import { FACE_BY_ID, FACE_LABEL, faceSize } from '../data/faces';
import { DUCT_LAYOUT_LABEL } from '../data/enclosures';
import { resolveArea } from './workArea';
import type { DeviceLookup, LayoutItem } from './layout';
import type {
  AiSettings,
  DuctLayoutId,
  FaceId,
  PanelSpec,
  Profile,
  Rotation,
  TapSize,
  Violation,
} from '../types';

/**
 * AI による自動配置。
 *
 * ここが決めるのは **並び順と段割り** だけで、座標は決めさせない。
 * 座標まで AI に出させると、クリアランス違反や重なりが混じったまま図になり、
 * 人が全部検算する羽目になる。段割りは「主幹は上・端子台は下」といった
 * 人の作法の話で、規則で書き下しにくい＝AI が役に立つところ。
 * 出てきた段割りは既存の詰め込みに渡し、座標と検査は今までどおり機械が持つ。
 */

/** AI に渡す機器1台。図面に必要な情報だけに絞る。 */
type AiDevice = {
  uid: string;
  model: string;
  category: string;
  w: number;
  h: number;
  /** 取付面からの突出 */
  d: number;
  mount: string;
  heatW?: number;
};

export type AiRequest = {
  /** 中板かどうか。決めさせるものが変わる */
  plate: boolean;
  face: string;
  /** 面の作図寸法 */
  size: { w: number; h: number };
  duct: { layout: string; width: number; layouts?: string[] };
  clearance: { deviceToDuct: { top: number; bottom: number }; sameRow: number };
  /** 加工有効範囲。未登録なら省く（面いっぱい使える） */
  area?: { rect: { x: number; y: number; w: number; h: number }; excludes: { x: number; y: number; w: number; h: number }[] };
  devices: AiDevice[];
};

/** AI が足す加工1件。座標は面の左下原点・中心指定。 */
export type AiCut =
  | { kind: 'hole'; x: number; y: number; dia: number; tap?: TapSize; note?: string }
  | { kind: 'notch'; x: number; y: number; w: number; h: number; note?: string };

/**
 * AI が返す配置案。
 *
 * 面によって決めるものが違う。
 * - 中板：**段割り**（と、ダクトの引き方）。座標は既存の詰め込みが出す
 * - それ以外の面：段が無いので**中心座標**そのもの。ただし機械が範囲と重なりを検査する
 */
export type AiPlan = {
  /** 中板：段ごとに、左から並べる順で uid を並べる */
  rows?: { index: number; uids: string[] }[];
  /** 中板：ダクトの引き方と段数 */
  duct?: { layout?: DuctLayoutId; rowCount?: number };
  /** 中板以外：機器の中心座標(mm)。面の左下が原点 */
  places?: { uid: string; x: number; y: number }[];
  /** 足す加工。押ボタンの開口など、機器から自動で出ないぶん */
  cuts?: AiCut[];
  /** 90°倒す機器。uid → 角度 */
  rotate?: Record<string, Rotation>;
  /** そう置いた理由。人が読んで納得できるかを確かめるために出させる */
  notes?: string[];
};

/** 面の情報と機器の一覧を、AI に渡す形にまとめる。 */
export function buildRequest(
  panel: PanelSpec,
  profile: Profile,
  face: FaceId,
  items: LayoutItem[],
  devices: DeviceLookup,
): AiRequest {
  const size = faceSize(panel, face);
  const plate = FACE_BY_ID.get(face)?.ducts ?? false;
  const area = resolveArea(panel, face);
  return {
    plate,
    face: FACE_LABEL(face),
    size,
    duct: {
      layout: DUCT_LAYOUT_LABEL[profile.duct.layout],
      width: profile.duct.width,
      ...(plate ? { layouts: Object.values(DUCT_LAYOUT_LABEL) } : {}),
    },
    clearance: {
      deviceToDuct: {
        top: profile.clearance.deviceToDuct.top,
        bottom: profile.clearance.deviceToDuct.bottom,
      },
      sameRow: profile.clearance.deviceToDevice.sameRow,
    },
    // 範囲が登録してあれば渡す。無ければ何も言わない（面いっぱい使える扱い）
    ...(area
      ? {
          area: {
            rect: round(area.rect),
            excludes: area.excludes.map(round),
          },
        }
      : {}),
    devices: items
      .filter((i) => i.face === face)
      .map((i): AiDevice | null => {
        const spec = devices.get(i.specId);
        return spec
          ? {
              uid: i.uid,
              model: spec.model,
              category: spec.category,
              w: spec.size.w,
              h: spec.size.h,
              d: spec.size.d,
              mount: i.mount,
              ...(spec.heatW ? { heatW: spec.heatW } : {}),
            }
          : null;
      })
      .filter((d): d is AiDevice => d !== null),
  };
}

/**
 * 盤屋の作法を指示にする。
 *
 * ここに書いてあることが、規則で書き下せないから AI に任せている中身そのもの。
 * 変えたくなったらこの文面を直す。
 */
/** どの面でも共通の作法。 */
const COMMON = [
  'あなたは日本の制御盤設計者です。渡された面の盤内レイアウトを決めます。',
  '',
  '出力は JSON だけ。説明文やコードフェンスを付けないでください。',
  '渡された uid をすべて、ちょうど1回ずつ使うこと。',
  'notes には決めた理由を日本語で3行以内。',
  '',
  'area が渡されたときは **加工有効範囲** です。rect の中だけが使え、',
  'excludes の矩形は使えません（ボルトホルダーなど）。機器も加工もこの中に収めること。',
  'area が無い面は面いっぱい使えます。',
];

/** 中板（ダクトを扱う面）の指示。段割りだけを決めさせる。 */
const PLATE_PROMPT = [
  ...COMMON,
  '',
  'この面は中板です。決めるのは「どの機器をどの段に、左からどの順で並べるか」と',
  '「ダクトの引き方」です。**座標は出さないでください**（座標は別の仕組みが計算します）。',
  '',
  '守る作法:',
  '- 電源の流れが上から下になるように置く。主幹ブレーカ→分岐ブレーカ→電磁接触器→制御機器→端子台の順',
  '- 主幹ブレーカは最上段の左端',
  '- 端子台は最下段にまとめる。外部配線を下から引き込むため',
  '- 発熱の大きい機器（heatW が大きいもの）は上の段に置く。熱は上に溜まるため',
  '- 同じ分類の機器は隣どうしに並べる。点検と結線がしやすい',
  '- 背の高い機器と低い機器を同じ段に混ぜすぎない。段の高さが無駄になる',
  '- 幅の合計が面の幅を超えないよう段を分ける。1段に詰め込みすぎない',
  '- ダクトは既定の「横ダクト段組み」で足りることが多い。幹線を縦に落としたいときだけ',
  '  縦ダクト付きのレイアウトにする。duct.layouts にある名前から選ぶこと',
  '',
  '形式:',
  '{"rows":[{"index":0,"uids":["..."]}],"duct":{"layout":"横ダクト段組み","rowCount":3},',
  ' "cuts":[{"kind":"notch","x":100,"y":200,"w":50,"h":30,"note":"..."}],',
  ' "rotate":{"uid":90},"notes":["..."]}',
  '',
  '- rows は上の段から順に。index は 0 から連番',
  '- duct は変えたいときだけ。rowCount は段の数',
  '- cuts は機器から自動で出ない加工だけ（ケーブル引き込みの切り欠きなど）。無ければ省く',
  '- rotate は縦長の機器を横に倒したいときだけ。値は 90 か 270',
];

/** 中板以外（扉・側面・背面など）の指示。座標そのものを決めさせる。 */
const FREE_PROMPT = [
  ...COMMON,
  '',
  'この面にはダクトも段もありません。**機器の中心座標を直接決めてください**。',
  '原点は面の左下 (0,0)、X は右、Y は上、単位は mm です。',
  '',
  '守る作法:',
  '- 押ボタン・表示灯は**操作しやすい高さ**に、横一列か格子状にそろえて並べる',
  '- 同じ種類のものは等間隔にそろえる。目分量でずらさない',
  '- 非常停止は他の操作器から離し、目立つ位置（左上か右上）に置く',
  '- 表示器（HMI）は面の中央寄り、目線の高さに置く',
  '- 座標は 5mm 刻みにそろえる。半端な数字は現場で嫌われる',
  '- 機器どうしを重ねない。外形の間を最低 20mm あける',
  '- 面の端に寄せすぎない。加工有効範囲があるときはその中に収める',
  '',
  '形式:',
  '{"places":[{"uid":"...","x":150,"y":600}],',
  ' "cuts":[{"kind":"hole","x":300,"y":400,"dia":22,"note":"..."},',
  '         {"kind":"notch","x":100,"y":200,"w":50,"h":30}],',
  ' "rotate":{"uid":90},"notes":["..."]}',
  '',
  '- places の x,y は機器の**中心**',
  '- cuts は機器から自動で出ない加工だけ（銘板の切り欠き、換気口など）。無ければ省く',
  '- タップ（tap）は中板でしか使えません。この面では丸穴か切り欠きにすること',
  '- rotate は縦長の機器を横に倒したいときだけ。値は 90 か 270',
];

/**
 * 盤屋の作法を指示にする。
 *
 * ここに書いてあることが、規則で書き下せないから AI に任せている中身そのもの。
 * 変えたくなったらこの文面を直す。中板とそれ以外で決めるものが違うので分けてある。
 */
export function systemPrompt(req: AiRequest): string {
  return (req.plate ? PLATE_PROMPT : FREE_PROMPT).join('\n');
}

/** 中板の指示文。古い呼び出しと自動テストのために残してある。 */
export const SYSTEM_PROMPT = PLATE_PROMPT.join('\n');

/** 直前の配置で出た違反を、次の依頼に添える文にする。 */
export function violationHint(violations: Violation[]): string {
  const msgs = violations.map((v) => v.message).slice(0, 12);
  if (msgs.length === 0) return '';
  return ['', '前回の案では次の問題が出ました。これを避ける案にしてください:', ...msgs.map((m) => `- ${m}`)].join(
    '\n',
  );
}

/**
 * 返ってきた文字列から配置案を取り出す。
 *
 * JSON だけ返すよう指示していても前置きが付くことがあるので、
 * 最初の `{` から最後の `}` までを拾う。
 */
export function parsePlan(text: string): AiPlan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as AiPlan;
    // 中板は rows、それ以外は places。どちらも無ければ配置案として読めない
    if (!Array.isArray(data.rows) && !Array.isArray(data.places)) return null;
    return data;
  } catch {
    return null;
  }
}

export type PlanCheck = { ok: true; plan: AiPlan } | { ok: false; reason: string };

/**
 * 配置案が使えるか確かめる。
 * 機器の取りこぼしや重複をそのまま反映すると図から機器が消えるので、必ず通す。
 */
export function validatePlan(plan: AiPlan, req: AiRequest): PlanCheck {
  const known = new Set(req.devices.map((d) => d.uid));
  const seen = new Set<string>();
  const note = req.plate ? '段' : '座標';

  const take = (uid: string): string | null => {
    if (!known.has(uid)) return `知らない機器が入っています: ${uid}`;
    if (seen.has(uid)) return `同じ機器が2回出ています: ${uid}`;
    seen.add(uid);
    return null;
  };

  if (req.plate) {
    if (!Array.isArray(plan.rows)) return { ok: false, reason: 'rows がありません' };
    for (const row of plan.rows) {
      if (!Array.isArray(row.uids)) return { ok: false, reason: '段の中身が配列ではありません' };
      for (const uid of row.uids) {
        const bad = take(uid);
        if (bad) return { ok: false, reason: bad };
      }
    }
  } else {
    if (!Array.isArray(plan.places)) return { ok: false, reason: 'places がありません' };
    for (const p of plan.places) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        return { ok: false, reason: `座標が数値ではありません: ${p.uid}` };
      const bad = take(p.uid);
      if (bad) return { ok: false, reason: bad };
    }
  }

  if (seen.size !== known.size) {
    const missing = [...known].filter((u) => !seen.has(u)).length;
    return { ok: false, reason: `${missing} 台が${note}に割り当てられていません` };
  }

  // 加工は面の中に収まっているか。外を指してきたら受け取らない
  for (const c of plan.cuts ?? []) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y))
      return { ok: false, reason: '加工の座標が数値ではありません' };
    if (c.x < 0 || c.y < 0 || c.x > req.size.w || c.y > req.size.h)
      return { ok: false, reason: `加工 X${c.x} Y${c.y} が面の外です` };
  }
  return { ok: true, plan };
}

const round = (r: { x: number; y: number; w: number; h: number }) => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});

/**
 * 送信先の既定値。
 *
 * Anthropic を直に叩くときは、ブラウザから呼ぶことを明示するヘッダが要る。
 * 社内にプロキシを立てる場合はそのURLに差し替える（そちらが本命。理由は README）。
 */
export const DEFAULT_AI: AiSettings = {
  endpoint: 'https://api.anthropic.com/v1/messages',
  model: 'claude-sonnet-5',
  apiKey: '',
  directBrowser: true,
  maxTokens: 4000,
};

/** 設定が足りているか。足りないものを日本語で返す。 */
export function aiReady(s: AiSettings): string | null {
  if (!s.endpoint.trim()) return '送信先が未設定です';
  // 社内プロキシならキーはサーバ側が持つので、直叩きのときだけ要る
  if (s.directBrowser && !s.apiKey.trim()) return 'API キーが未設定です';
  return null;
}

/**
 * AI に段割りを依頼する。
 *
 * 返答の形は Anthropic Messages API に合わせている。
 * 社内プロキシを立てる場合も、同じ形で返すようにしてもらうのがいちばん楽。
 */
export async function requestPlan(
  s: AiSettings,
  req: AiRequest,
  extra = '',
): Promise<{ plan: AiPlan | null; raw: string; error?: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.apiKey.trim()) {
    headers['x-api-key'] = s.apiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
  }
  if (s.directBrowser) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  const body = {
    model: s.model,
    max_tokens: s.maxTokens,
    system: systemPrompt(req),
    messages: [{ role: 'user', content: JSON.stringify(req) + extra }],
  };

  try {
    const res = await fetch(s.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      return { plan: null, raw: '', error: `送信先が ${res.status} を返しました: ${await res.text()}` };
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (data.content ?? []).map((c) => c.text ?? '').join('');
    return { plan: parsePlan(raw), raw };
  } catch (e) {
    return { plan: null, raw: '', error: `つながりませんでした: ${String(e)}` };
  }
}
