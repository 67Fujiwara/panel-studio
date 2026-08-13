import { useMemo, useState } from 'react';
import { aiReady, buildRequest, requestPlan, validatePlan, violationHint } from '../lib/ai';
import type { DeviceLookup } from '../lib/layout';
import { deviceLookup, useStore } from '../store';
import type { LayoutResult } from '../types';

/**
 * AI に段割りを頼むところ。
 *
 * AI が決めるのは「どの機器をどの段に、どの順で」だけ。座標は今までどおり
 * 詰め込みが計算し、クリアランスと重なりの検査も機械が持つ。
 * だから AI の答えが多少雑でも、図が壊れた状態で出ることはない。
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
    setMsg(`${plan.rows.length} 段に割り付けました。`);
  };

  return (
    <div className="ai-box">
      <h3>AI 自動配置</h3>
      <p className="note">
        使用部品を<b>どの段にどの順で並べるか</b>を AI に決めさせます。
        座標とクリアランスの検査はこれまでどおり機械が持つので、
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
              {busy ? '考えています…' : `AI に並べてもらう（${count} 台）`}
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

      {msg && <p className={`calc${msg.includes('割り付け') ? '' : ' bad'}`}>{msg}</p>}
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
