import { FACE_LABEL, faceSize } from '../data/faces';
import { DUCT_LAYOUT_LABEL } from '../data/enclosures';
import type { DeviceLookup, LayoutItem } from './layout';
import type { AiSettings, FaceId, PanelSpec, Profile, Rotation, Violation } from '../types';

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
  face: string;
  /** 面の作図寸法 */
  size: { w: number; h: number };
  duct: { layout: string; width: number };
  clearance: { deviceToDuct: { top: number; bottom: number }; sameRow: number };
  devices: AiDevice[];
};

/** AI が返す配置案。段ごとに、左から並べる順で uid を並べる。 */
export type AiPlan = {
  rows: { index: number; uids: string[] }[];
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
  return {
    face: FACE_LABEL(face),
    size,
    duct: { layout: DUCT_LAYOUT_LABEL[profile.duct.layout], width: profile.duct.width },
    clearance: {
      deviceToDuct: {
        top: profile.clearance.deviceToDuct.top,
        bottom: profile.clearance.deviceToDuct.bottom,
      },
      sameRow: profile.clearance.deviceToDevice.sameRow,
    },
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
export const SYSTEM_PROMPT = [
  'あなたは日本の制御盤設計者です。中板（取付板）の盤内レイアウトを決めます。',
  '',
  '決めるのは「どの機器をどの段に、左からどの順で並べるか」だけです。',
  '座標は出さないでください（座標は別の仕組みが計算します）。',
  '',
  '守る作法:',
  '- 電源の流れが上から下になるように置く。主幹ブレーカ→分岐ブレーカ→電磁接触器→制御機器→端子台の順',
  '- 主幹ブレーカは最上段の左端',
  '- 端子台は最下段にまとめる。外部配線を下から引き込むため',
  '- 発熱の大きい機器（heatW が大きいもの）は上の段に置く。熱は上に溜まるため',
  '- 同じ分類の機器は隣どうしに並べる。点検と結線がしやすい',
  '- 背の高い機器と低い機器を同じ段に混ぜすぎない。段の高さが無駄になる',
  '- 幅の合計が面の幅を超えないよう段を分ける。1段に詰め込みすぎない',
  '',
  '出力は JSON だけ。説明文やコードフェンスを付けないでください。形式:',
  '{"rows":[{"index":0,"uids":["..."]}],"rotate":{"uid":90},"notes":["..."]}',
  '',
  '- rows は上の段から順に。index は 0 から連番',
  '- 渡された uid をすべて、ちょうど1回ずつ使うこと',
  '- rotate は縦長の機器を横に倒したいときだけ。値は 90 か 270',
  '- notes には段割りの理由を日本語で3行以内',
].join('\n');

/** 直前の配置で出た違反を、次の依頼に添える文にする。 */
export function violationHint(violations: Violation[]): string {
  const msgs = violations.map((v) => v.message).slice(0, 12);
  if (msgs.length === 0) return '';
  return ['', '前回の案では次の問題が出ました。これを避ける段割りにしてください:', ...msgs.map((m) => `- ${m}`)].join(
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
    if (!Array.isArray(data.rows)) return null;
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

  for (const row of plan.rows) {
    if (!Array.isArray(row.uids)) return { ok: false, reason: '段の中身が配列ではありません' };
    for (const uid of row.uids) {
      if (!known.has(uid)) return { ok: false, reason: `知らない機器が入っています: ${uid}` };
      if (seen.has(uid)) return { ok: false, reason: `同じ機器が2回出ています: ${uid}` };
      seen.add(uid);
    }
  }
  if (seen.size !== known.size) {
    const missing = [...known].filter((u) => !seen.has(u)).length;
    return { ok: false, reason: `${missing} 台が段に割り当てられていません` };
  }
  return { ok: true, plan };
}

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
    system: SYSTEM_PROMPT,
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
