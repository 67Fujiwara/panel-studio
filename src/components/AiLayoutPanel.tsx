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
  const go = useStore((s) => s.go);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [notes, setNotes] = useState<string[]>([]);

  const missing = aiReady(ai);
  const count = items.filter((i) => i.face === face).length;
  const plate = FACE_BY_ID.get(face)?.ducts ?? false;

  const run = async (withHint: boolean) => {
    setBusy(true);
    setMsg('');
    setNotes([]);
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
            <button className="primary" disabled={busy || count === 0} onClick={() => void run(false)}>
              {busy ? '考えています…' : `AI に${plate ? '並べて' : '置いて'}もらう（${count} 台）`}
            </button>
            {layout.violations.length > 0 && (
              <button disabled={busy} onClick={() => void run(true)}>
                違反を伝えてやり直す
              </button>
            )}
          </div>
          {count === 0 && <p className="note">先に使用部品を選んでください。</p>}
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
    </div>
  );
}
