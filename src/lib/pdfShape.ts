/**
 * 加工有効範囲図（PDF）の取り込み。
 *
 * ⚠ **この図から範囲を自動で読み取ることはしない。**
 *    図面自身に「模式的に加工可能範囲を示すもので、図中の寸法値通りに図形が
 *    描画されていません」と注記がある。形が実寸でない以上、線を拾っても意味がない。
 *
 * ここでやるのは**図をアプリの中に表示すること**だけ。
 * 別ウィンドウで PDF を開いて数値を読み、こちらへ切り替えて打ち込む — の
 * 行ったり来たりを無くすのが目的。図は型式と一緒に保存するので、次からは開き直さなくていい。
 *
 * PDF の中身はベクタなので、線を抜き出して SVG に描き直す。
 * 画像に焼くと拡大したときに読めなくなり、寸法値を読む用途に耐えない。
 */

/** 取り込んだ図1ページぶん。SVG のパス片として持つ。 */
export type PdfPage = {
  /** ページの大きさ（PDF のポイント） */
  w: number;
  h: number;
  /** 折れ線。[x0,y0,x1,y1,...] を並べたもの */
  polys: number[][];
};

/** PDF から取り出した図。型式マスタと一緒に保存する。 */
export type PdfDrawing = {
  /** 取り込んだファイル名。どの図か分かるように残す */
  name: string;
  pages: PdfPage[];
};

/** FlateDecode を解く。ブラウザ標準の DecompressionStream を使う（依存を増やさない）。 */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  for (const fmt of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(fmt);
      const buf = bytes.slice().buffer as ArrayBuffer;
      const out = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
      if (out.byteLength > 0) return new Uint8Array(out);
    } catch {
      // 次の方式で試す
    }
  }
  return null;
}

const ascii = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
};

/** `stream` … `endstream` の中身をすべて取り出して展開する。 */
async function inflateStreams(bytes: Uint8Array): Promise<string[]> {
  const text = ascii(bytes);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) continue;
    // `endstream` の直前の改行まで渡すと「圧縮データの後ろにゴミ」で展開に失敗する。
    // 仕様上ここに改行が入るので、削ってから渡す
    let last = end;
    while (last > start && (bytes[last - 1] === 10 || bytes[last - 1] === 13)) last--;
    const raw = await inflate(bytes.subarray(start, last));
    if (raw) out.push(ascii(raw));
  }
  return out;
}

/** MediaBox からページの大きさを拾う。無ければ A3 横を仮定する。 */
function pageSize(text: string): { w: number; h: number } {
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
  if (!m) return { w: 1191, h: 842 };
  return { w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) };
}

/**
 * 内容ストリームを折れ線の集まりに直す。
 *
 * 扱うのは m / l / c / re だけ。加工有効範囲図は直線と四角がほとんどで、
 * 曲線は文字の輪郭くらいしか無い（c は終点だけ拾って折れ線で近似する）。
 */
function toPolys(content: string): number[][] {
  const toks = content.split(/\s+/);
  const polys: number[][] = [];
  let cur: number[] = [];
  const nums: number[] = [];
  const close = () => {
    if (cur.length >= 4) polys.push(cur);
    cur = [];
  };
  for (const t of toks) {
    const n = Number(t);
    if (t !== '' && !Number.isNaN(n)) {
      nums.push(n);
      if (nums.length > 8) nums.shift();
      continue;
    }
    const last = (k: number) => nums.slice(-k);
    if (t === 'm' && nums.length >= 2) {
      close();
      cur = last(2);
    } else if ((t === 'l' || t === 'c') && nums.length >= 2) {
      // c は制御点を捨てて終点だけ。この縮尺では折れ線で足りる
      const [x, y] = last(2);
      if (cur.length === 0) cur = [x!, y!];
      else cur.push(x!, y!);
    } else if (t === 're' && nums.length >= 4) {
      const [x, y, w, h] = last(4) as [number, number, number, number];
      close();
      polys.push([x, y, x + w, y, x + w, y + h, x, y + h, x, y]);
    } else if (t === 'S' || t === 's' || t === 'f' || t === 'f*' || t === 'B' || t === 'n') {
      close();
    }
    nums.length = 0;
  }
  close();
  return polys;
}

/** 描いた線が多すぎると保存も描画も重いので、上限を決めておく。 */
const MAX_POLYS = 40000;

/**
 * PDF を読み込んで図に直す。
 * ページごとに分けず、大きな内容ストリームを1ページとして扱う
 * （加工有効範囲図は1〜2ページで、ページ番号よりも「図が出ること」が大事）。
 */
export async function readPdfDrawing(file: File): Promise<PdfDrawing> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = pageSize(ascii(bytes.subarray(0, 4000)));
  const streams = await inflateStreams(bytes);
  const pages: PdfPage[] = [];
  for (const s of streams) {
    // 図の入っているストリームだけ。設定やフォントのストリームは短い
    if (s.length < 5000) continue;
    const polys = toPolys(s).slice(0, MAX_POLYS);
    if (polys.length > 20) pages.push({ ...size, polys });
  }
  if (pages.length === 0) throw new Error('図形を取り出せませんでした（画像だけの PDF かもしれません）');
  return { name: file.name, pages };
}
