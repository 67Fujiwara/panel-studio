import { useMemo, useState } from 'react';
import { FACES, FACE_LABEL } from '../data/faces';
import { aiReady, buildRequest, requestPlan, validatePlan } from '../lib/ai';
import { deviceLookup, useStore } from '../store';
import type { FaceId } from '../types';

type Result = { face: FaceId; ok: boolean; text: string };

/**
 * 全面まとめて AI 自動配置。
 *
 * 面を1つずつ開いて押して回るのは、面が7つある以上どうしても手間になる。
 * ここから押せば、**部品を置いた面と加工有効範囲を登録した面**をまとめて回す。
 *
 * 面ごとに独立した依頼にするのは、1回でまとめて出させると
 * どこかの面の失敗が全部を巻き込むため。1面が失敗しても他は残る。
 */
export function AiAllFaces() {
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const items = useStore((s) => s.items);
  const devices = useStore((s) => s.devices);
  const myDevices = useStore((s) => s.myDevices);
  const ai = useStore((s) => s.ai);
  const applyAiPlan = useStore((s) => s.applyAiPlan);
  const undoAiPlan = useStore((s) => s.undoAiPlan);
  const addHouseRule = useStore((s) => s.addHouseRule);
  const go = useStore((s) => s.go);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);
  const [busy, setBusy] = useState<FaceId | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const missing = aiReady(ai);

  // 部品を置いた面だけ回す。何も無い面まで頼むと、要らない加工が増えるだけになる
  const targets = FACES.map((f) => f.id).filter((id) =>
    items.some((i) => i.face === id),
  );

  const runAll = async () => {
    const out: Result[] = [];
    setResults([]);
    setPending(false);
    let applied = false;
    for (const face of targets) {
      setBusy(face);
      // 画面は切り替えない。切り替えるとこの画面ごと消えて、結果が見えなくなる
      const req = buildRequest(panel, profile, face, items, lookup);
      const { plan, error } = await requestPlan(ai, req, '');
      if (error || !plan) {
        out.push({ face, ok: false, text: error ?? '案として読めませんでした' });
      } else {
        const check = validatePlan(plan, req);
        if (!check.ok) out.push({ face, ok: false, text: check.reason });
        else {
          // 2面目からは控えを上書きしない。まとめて1回で戻せるようにする
          applyAiPlan(check.plan, { face, keepUndo: applied });
          applied = true;
          const n = check.plan.rows?.length ?? check.plan.places?.length ?? 0;
          const cuts = check.plan.cuts?.length ?? 0;
          out.push({
            face,
            ok: true,
            text: `${n} ${check.plan.rows ? '段' : '台'}${cuts > 0 ? `／加工 ${cuts} 件` : ''}`,
          });
        }
      }
      setResults([...out]);
    }
    setBusy(null);
    setPending(applied);
  };

  /** まとめて不採用。回す前の状態に戻す。 */
  const reject = () => {
    const back = undoAiPlan();
    if (feedback.trim()) addHouseRule(feedback.trim());
    setPending(false);
    setResults([]);
    setFeedback('');
    if (!back) return;
  };

  return (
    <div className="ai-box">
      <h3>AI 自動配置（全面まとめて）</h3>
      <p className="note">
        部品を置いた面をまとめて回します。面ごとに別の依頼にするので、
        どこかの面が失敗しても他の面は残ります。
        採否は<b>まとめて1回</b>で、不採用なら全面が回す前に戻ります。
      </p>
      {missing ? (
        <>
          <p className="calc bad">{missing}</p>
          <button onClick={() => go('config')}>設定画面で接続先を入れる →</button>
        </>
      ) : targets.length === 0 ? (
        <p className="note">まだどの面にも部品がありません。面を開いて使用部品を選んでください。</p>
      ) : (
        <div className="row-buttons">
          <button className="primary" disabled={busy !== null} onClick={() => void runAll()}>
            {busy ? `${FACE_LABEL(busy)} を考えています…` : `${targets.length} 面をまとめて配置`}
          </button>
        </div>
      )}
      {results.length > 0 && (
        <ul className="ai-notes">
          {results.map((r) => (
            <li key={r.face} className={r.ok ? undefined : 'bad'}>
              <b>{FACE_LABEL(r.face)}</b> — {r.text}
            </li>
          ))}
        </ul>
      )}

      {/* 採否はまとめて1回。回す前の状態にまとめて戻せる */}
      {pending && (
        <div className="ai-verdict">
          <p className="note">
            この結果を<b>採用しますか</b>。不採用なら<b>全面まとめて</b>回す前に戻します。
            面ごとに直したいときは、採用してから各面の画面で調整してください。
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
          <div className="row-buttons">
            <button
              className="primary"
              onClick={() => {
                setPending(false);
                setFeedback('');
              }}
            >
              採用する
            </button>
            <button onClick={reject}>不採用（全面を元に戻す）</button>
          </div>
        </div>
      )}
    </div>
  );
}
