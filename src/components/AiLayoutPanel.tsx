import { useMemo, useState } from 'react';
import { aiReady, buildRequest, requestPlan, validatePlan, violationHint } from '../lib/ai';
import { FACE_BY_ID } from '../data/faces';
import type { DeviceLookup } from '../lib/layout';
import { deviceLookup, useStore } from '../store';
import type { LayoutResult } from '../types';

/**
 * AI に配置を頼むところ。
 *
 * 面によって決めさせるものが違う。
 * - **中板**：段割りとダクトの引き方だけ。座標は今までどおり詰め込みが計算する
 * - **それ以外**：段が無いので中心座標そのもの。ただし置いたあと機械が検査する
 *
 * どちらの場合も、クリアランス・重なり・加工有効範囲の検査は機械が持つ。
 * だから AI の答えが雑でも、不備が見えない図が出ることはない。
 * 違反が残ったら「違反を伝えてやり直す」で、その内容を添えてもう一度頼める。
 */
export function AiLayoutPanel({ layout }: { layout: LayoutResult; devices: DeviceLookup }) {
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const face = useStore((s) => s.face);
  const items = useStore((s) => s.items);
  const devices = useStore((s) => s.devices);
  const myDevices = useStore((s) => s.myDevices);
  const ai = useStore((s) => s.ai);
  const applyAiPlan = useStore((s) => s.applyAiPlan);
  const undoAiPlan = useStore((s) => s.undoAiPlan);
  const addHouseRule = useStore((s) => s.addHouseRule);
  const go = useStore((s) => s.go);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [notes, setNotes] = useState<string[]>([]);
  /** 直前に当てた案の採否がまだ決まっていないか */
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');

  const missing = aiReady(ai);
  const count = items.filter((i) => i.face === face).length;
  const plate = FACE_BY_ID.get(face)?.ducts ?? false;

  const run = async (withHint: boolean) => {
    setBusy(true);
    setMsg('');
    setNotes([]);
    setPending(false);
    const req = buildRequest(panel, profile, face, items, lookup);
    const extra = withHint ? violationHint(layout.violations) : '';
    const { plan, error } = await requestPlan(ai, req, extra);
    setBusy(false);

    if (error) return setMsg(error);
    if (!plan) return setMsg('返ってきた内容を配置案として読めませんでした。');
    const check = validatePlan(plan, req);
    if (!check.ok) return setMsg(`配置案が使えません: ${check.reason}`);

    applyAiPlan(check.plan);
    setNotes(check.plan.notes ?? []);
    const cuts = check.plan.cuts?.length ?? 0;
    const cutMsg = cuts > 0 ? `／加工 ${cuts} 件を追加` : '';
    setMsg(
      plate
        ? `${check.plan.rows?.length ?? 0} 段に割り付けました${cutMsg}。`
        : `${check.plan.places?.length ?? 0} 台を配置しました${cutMsg}。`,
    );
    setPending(true);
  };

  /** 採用。控えを捨てるだけで、図はそのまま。 */
  const accept = () => {
    setPending(false);
    setFeedback('');
    setMsg('採用しました。');
  };

  /**
   * 不採用。押す前の状態に戻し、書いてもらった理由を次からの指示に足す。
   * ⚠ モデルを学習させるわけではない（API 越しに学習はできない）。毎回の指示に添えるだけ。
   */
  const reject = () => {
    const back = undoAiPlan();
    if (feedback.trim()) addHouseRule(feedback.trim());
    setPending(false);
    setNotes([]);
    setFeedback('');
    setMsg(
      back
        ? feedback.trim()
          ? '元に戻しました。書いていただいた内容は次からの指示に足します。'
          : '元に戻しました。'
        : '戻せる控えがありませんでした。',
    );
  };

  return (
    <div className="ai-box">
      <h3>AI 自動配置</h3>
      <p className="note">
        {plate ? (
          <>
            使用部品を<b>どの段にどの順で並べるか</b>と<b>ダクトの引き方</b>を AI に決めさせます。
            座標は今までどおり詰め込みが計算します。
          </>
        ) : (
          <>
            使用部品を<b>面のどこに置くか</b>を AI に決めさせます。
            押ボタンの高さや並びのそろえ方など、規則で書きにくいところが対象です。
          </>
        )}
        {' '}
        クリアランス・重なり・<b>加工有効範囲</b>の検査は機械が持つので、
        AI の答えがそのまま図の不備になることはありません。
      </p>

      {missing ? (
        <>
          <p className="calc bad">{missing}</p>
          <button onClick={() => go('config')}>設定画面で接続先を入れる →</button>
        </>
      ) : (
        <>
          <div className="row-buttons">
            <button className="primary" disabled={busy} onClick={() => void run(false)}>
              {busy
                ? '考えています…'
                : count === 0
                  ? 'AI に加工を考えてもらう'
                  : `AI に${plate ? '並べて' : '置いて'}もらう（${count} 台）`}
            </button>
            {layout.violations.length > 0 && (
              <button disabled={busy} onClick={() => void run(true)}>
                違反を伝えてやり直す
              </button>
            )}
          </div>
          {count === 0 && (
            <p className="note">
              使用部品を選んでいないので、<b>加工だけ</b>を考えてもらいます
              （換気口・ケーブル引き込みの切り欠きなど）。
            </p>
          )}
        </>
      )}

      {msg && (
        <p className={`calc${msg.includes('割り付け') || msg.includes('配置し') ? '' : ' bad'}`}>
          {msg}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="ai-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {/*
        採否を必ず人に決めさせる。自動で確定させると、気づかないうちに
        AI の案で図が進んでしまう。不採用なら押す前に戻す。
      */}
      {pending && (
        <div className="ai-verdict">
          <p className="note">
            この案を<b>採用しますか</b>。不採用なら押す前の状態に戻します。
          </p>
          <label className="num">
            <span>
              気になったところ<em>不採用のときは書いてください</em>
            </span>
            <input
              type="text"
              value={feedback}
              placeholder="例: 端子台は必ず右端から並べる"
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <p className="note">
            書いた内容は<b>次からの依頼に指示として毎回添えます</b>
            （設定画面で確認・削除できます）。
            モデルそのものを学習させるものではありません。
          </p>
          <div className="row-buttons">
            <button className="primary" onClick={accept}>
              採用する
            </button>
            <button onClick={reject}>不採用（元に戻す）</button>
          </div>
        </div>
      )}
    </div>
  );
}
