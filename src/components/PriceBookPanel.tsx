import { useState } from 'react';
import { buildPriceBook, guessColumns, parseCsv } from '../lib/price';
import { useStore } from '../store';

/**
 * 単価表の取り込み。
 *
 * ミスミの価格をアプリから自動で引くことはしない（理由は lib/price.ts の頭に書いた）。
 * 代わりに、ミスミが公式に用意している**型番リストの一括見積**を往復する。
 * 見積 CSV の列構成はこちらで決め打ちにせず、**人に選ばせる**。
 * 決め打ちにすると、先方の書式が変わったときに直せなくなる。
 */
export function PriceBookPanel() {
  const prices = useStore((s) => s.prices);
  const mergePrices = useStore((s) => s.mergePrices);
  const clearPrices = useStore((s) => s.clearPrices);

  const [rows, setRows] = useState<string[][] | null>(null);
  const [cols, setCols] = useState({ key: 0, unit: 1, supplier: -1 });
  const [skipHeader, setSkipHeader] = useState(true);
  const [supplier, setSupplier] = useState('ミスミ');
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState('');

  const count = Object.keys(prices).length;
  const header = rows?.[0] ?? [];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setMsg('');
    // 見積 CSV は Shift-JIS のことが多い。まず UTF-8 で読み、化けたら CP932 で読み直す
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf);
    const parsed = parseCsv(text);
    if (parsed.length === 0) return setMsg('中身を読み取れませんでした。');
    setRows(parsed);
    setCols(guessColumns(parsed[0] ?? []));
  };

  const apply = () => {
    if (!rows) return;
    const { book, added, skipped } = buildPriceBook(rows, cols, { skipHeader, supplier, at });
    mergePrices(book);
    setRows(null);
    setMsg(`${added} 件を取り込みました${skipped > 0 ? `（${skipped} 行は単価が読めず飛ばしました）` : ''}。`);
  };

  const pick = (label: string, value: number, onChange: (v: number) => void, none = false) => (
    <label className="sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {none && <option value={-1}>使わない</option>}
        {header.map((h, i) => (
          <option key={i} value={i}>
            {i + 1}列目{h.trim() ? `: ${h}` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <h3 className="section">単価表（{count} 件）</h3>
      <p className="note">
        BOM に<b>単価・金額・合計</b>を出すための表です。型番をキーにして持つので、
        機器だけでなく<b>DINレール・ダクト・ネジ</b>にも値段が付きます。
      </p>
      <p className="note warn">
        ⚠ <b>ミスミの価格をこのアプリから自動で取ることはしていません。</b>
        共有フォルダの HTML から外部サイトは読めず（CORS）、
        公開ページの価格は<b>御社の契約価格とは違う</b>ためです。
        見積書に載る数字なので、違う数字が入るより空のほうが安全と判断しました。
        代わりにミスミの<b>型番リスト一括見積</b>を往復します。
      </p>
      <ol className="note steps">
        <li>面選択画面の「見積依頼 CSV（型番＋数量）」を書き出す</li>
        <li>ミスミのサイトでその CSV を一括見積にかける</li>
        <li>返ってきた見積 CSV を、ここで読み込む</li>
      </ol>

      <div className="row-buttons">
        <label className="filebtn">
          見積 CSV を読み込む
          <input
            type="file"
            accept=".csv,.txt,.tsv"
            onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
          />
        </label>
        <button disabled={count === 0} onClick={() => clearPrices()}>
          単価表を空にする
        </button>
      </div>
      {msg && <p className="calc">{msg}</p>}

      {rows && (
        <div className="excludes">
          <div className="excludes-head">
            <h4>どの列を使いますか（{rows.length} 行）</h4>
            <button onClick={() => setRows(null)}>やめる</button>
          </div>
          <p className="note">
            先方の書式を決め打ちにしていないので、<b>列は毎回ここで選びます</b>。
            書式が変わっても直せるようにするためです。
          </p>
          <div className="grid3">
            {pick('型番の列', cols.key, (key) => setCols({ ...cols, key }))}
            {pick('単価の列', cols.unit, (unit) => setCols({ ...cols, unit }))}
            {pick('仕入先の列', cols.supplier, (s2) => setCols({ ...cols, supplier: s2 }), true)}
          </div>
          <div className="grid3">
            <label className="num">
              <span>仕入先（列を使わないとき）</span>
              <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </label>
            <label className="num">
              <span>
                いつ時点の値か<em>見積は水物なので必ず残す</em>
              </span>
              <input type="date" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={skipHeader}
                onChange={(e) => setSkipHeader(e.target.checked)}
              />
              <span>1行目は見出し</span>
            </label>
          </div>

          <table className="backup-io">
            <thead>
              <tr>
                <th>型番</th>
                <th>単価</th>
                <th>仕入先</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(skipHeader ? 1 : 0, skipHeader ? 6 : 5).map((r, i) => (
                <tr key={i}>
                  <td>{r[cols.key]}</td>
                  <td>{r[cols.unit]}</td>
                  <td>{cols.supplier >= 0 ? r[cols.supplier] : supplier}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">上は最初の数行の見え方です。ここが合っていれば取り込めます。</p>
          <div className="row-buttons">
            <button className="primary" onClick={apply}>
              この列で取り込む
            </button>
          </div>
        </div>
      )}
    </>
  );
}
