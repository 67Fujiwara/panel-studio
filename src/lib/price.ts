import type { BomLine, BomSettings, PriceBook, PriceEntry } from '../types';

/**
 * 単価と金額。
 *
 * **ミスミの価格をこのアプリから自動で引くことはしない。**
 * - 共有フォルダの HTML（file://）から外部サイトを読むと CORS で落ちる
 * - 公開ページから取れるのは標準価格で、契約価格とは違う。
 *   見積書に載る数字なので、違う数字が入るくらいなら空のほうが安全
 * - 相手の HTML が変わると黙って壊れる。壊れたことに気づけないのが一番まずい
 *
 * 代わりに、ミスミが公式に用意している**型番リストの一括見積**を往復する。
 *
 *   BOM → 型番＋数量の CSV → ミスミで一括見積 → 見積 CSV → ここへ読み込む
 *
 * 読み込み側は列を人に選ばせる。先方の CSV の列構成をこちらで決め打ちすると、
 * 変わったときに直せなくなるため。
 *
 * **値段を付けるのは機器だけ。** DINレール・配線ダクト・取付ネジ（派生部品）は外す。
 * 定尺を切って使うものと在庫のネジで、案件ごとに型番で買うものではない。
 * 拾っても金額が合わないし、見積依頼に混ぜても先方で弾かれる行が増えるだけになる。
 */

/** 派生部品（DINレール・ダクト・ネジ）は値段を付けない。 */
const priceable = (l: BomLine) => l.source !== 'derived';

/**
 * CSV の1セル。**必要なときだけ**ダブルクォートで括る（CSV の作法どおり）。
 * 何でも括ると、括り文字を外さない相手に渡したときに値そのものが変わってしまう。
 */
const csvCell = (v: string, d: string) =>
  v.includes(d) || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;

/**
 * 見積依頼用の CSV。**ミスミの「型番一括入力」にそのまま入る書式**にする。
 *
 *   お客さま注文番号, 型番（必須）, メーカー名, 数量（必須）, 希望出荷日
 *
 * 区切り=カンマ / 先頭行=タイトル行 / CRLF 改行。
 *
 * **ダブルクォートで括らない。** 先方は括り文字を外さずそのまま取り込むので、
 * 全項目を括ると型番が `"LS7_BWC"` という文字列になって「解決しない」と出るし、
 * 数量も `"1"` になって「半角5ケタ以内で入力してください」で弾かれる。
 * カンマや引用符を含むセルだけ、CSV の作法どおり最小限で括る
 * （型番・数量にそんな文字は入らないので、実質すべて素の値で出る）。
 */
export function quoteRequestCsv(
  lines: BomLine[],
  opts: { orderNo?: string; shipDate?: string } = {},
): string {
  const q = (v: string) => csvCell(v, ',');
  const rows = [
    ['お客さま注文番号', '型番（必須）', 'メーカー名', '数量（必須）', '希望出荷日']
      .map(q)
      .join(','),
  ];
  for (const l of lines) {
    // DINレール・ダクト・ネジは載せない（型番で買うものではないので先方で弾かれる）
    if (!priceable(l)) continue;
    const key = l.key ?? l.model;
    if (!key) continue;
    rows.push(
      [
        q(opts.orderNo ?? ''),
        q(key),
        // メーカー名は任意。「—」は BOM の見た目用の記号なので送らない
        q(l.maker && l.maker !== '—' ? l.maker : ''),
        q(String(l.qty)),
        q(opts.shipDate ?? ''),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

/**
 * CSV を行×列に分解する。引用符とカンマ入りセルを扱えるだけの最小限。
 * 見積 CSF は品名にカンマが入ることがあるので、素朴な split では足りない。
 */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',' || c === '\t' || c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      // 次の \n で行を閉じる
    } else if (c === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((v) => v.trim() !== ''));
}

/** 数字だけを取り出す。「1,234 円」「\1234」のような書き方に耐えるため。 */
export function toNumber(v: string): number | null {
  const n = Number(v.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && v.trim() !== '' ? n : null;
}

/**
 * 列の見出しから、型番・単価・仕入先らしい列を推測する。
 * あくまで初期選択で、人が選び直せる前提。
 */
export function guessColumns(header: string[]): { key: number; unit: number; supplier: number } {
  const find = (words: string[], fallback: number) => {
    const i = header.findIndex((h) => words.some((w) => h.includes(w)));
    return i >= 0 ? i : fallback;
  };
  return {
    key: find(['型番', '品番', '型式', 'コード'], 0),
    unit: find(['単価', '価格', '金額'], 1),
    supplier: find(['仕入', 'メーカー', 'ブランド', '取扱'], -1),
  };
}

/** 選んだ列で単価表を作る。 */
export function buildPriceBook(
  rows: string[][],
  cols: { key: number; unit: number; supplier: number },
  opts: { skipHeader: boolean; supplier: string; at: string },
): { book: PriceBook; added: number; skipped: number } {
  const book: PriceBook = {};
  let added = 0;
  let skipped = 0;
  for (const r of rows.slice(opts.skipHeader ? 1 : 0)) {
    const key = (r[cols.key] ?? '').trim();
    const unit = toNumber(r[cols.unit] ?? '');
    if (!key || unit === null) {
      skipped++;
      continue;
    }
    const supplier = (cols.supplier >= 0 ? r[cols.supplier] : '')?.trim() || opts.supplier;
    book[key] = { unit, supplier, at: opts.at };
    added++;
  }
  return { book, added, skipped };
}

/** 単価表を引いた BOM 1行。 */
export type PricedLine = BomLine & {
  price: PriceEntry | null;
  /** 単価 × 数量。単価が無ければ null */
  amount: number | null;
};

/** 見つからなかった行に出す文言。金額欄を空にするより、理由が読めるほうがよい。 */
export const NO_PRICE = 'ミスミ取扱なし';

/** 値段を付けない行に出す文言。「調べたが無かった」と区別する。 */
export const NOT_PRICED = '対象外';

export function priceLines(lines: BomLine[], book: PriceBook): PricedLine[] {
  return lines.map((l) => {
    if (!priceable(l)) return { ...l, price: null, amount: null };
    const price = book[l.key ?? l.model] ?? null;
    return { ...l, price, amount: price ? price.unit * l.qty : null };
  });
}

/**
 * 単価が付いた行の合計。
 * 単価が無い機器は数えない（数えると総額が過小になる）。
 * 派生部品は初めから対象外なので「不明」にも数えない（毎回出ると警告が効かなくなる）。
 */
export function priceTotal(lines: PricedLine[]): { total: number; missing: number } {
  let total = 0;
  let missing = 0;
  for (const l of lines) {
    if (!priceable(l)) continue;
    if (l.amount === null) missing++;
    else total += l.amount;
  }
  return { total, missing };
}

/**
 * 金額つきの BOM CSV。
 * 単価が無い行は金額を空にせず「ミスミ取扱なし」と書く。空欄だと
 * 「ゼロ円」なのか「調べていない」のか読めないため。
 * 派生部品（DINレール・ダクト・ネジ）は初めから値段を付けないので「対象外」と書く。
 */
export function pricedBomCsv(lines: PricedLine[], s: BomSettings): string {
  const d = s.delimiter;
  const head = ['型式', 'メーカー / 品名', '数量', '単位', '区分', '単価', '金額', '仕入先'];
  const rows: string[] = [];
  if (s.withHeader) rows.push(head.map((h) => csvCell(h, d)).join(d));
  for (const l of lines) {
    const none = csvCell(priceable(l) ? NO_PRICE : NOT_PRICED, d);
    rows.push(
      [
        csvCell(l.model, d),
        csvCell(`${l.maker} / ${l.name}`, d),
        String(l.qty),
        csvCell(l.unit, d),
        l.source === 'derived' ? '派生部品' : '機器',
        l.price ? String(l.price.unit) : none,
        l.amount === null ? none : String(l.amount),
        csvCell(l.price?.supplier ?? '', d),
      ].join(d),
    );
  }
  const { total, missing } = priceTotal(lines);
  rows.push('');
  rows.push([csvCell('合計', d), '', '', '', '', '', String(total), ''].join(d));
  if (missing > 0) {
    rows.push(
      [csvCell(`※ 単価不明 ${missing} 件は合計に含みません`, d), '', '', '', '', '', '', ''].join(d),
    );
  }
  return rows.join('\r\n') + '\r\n';
}
