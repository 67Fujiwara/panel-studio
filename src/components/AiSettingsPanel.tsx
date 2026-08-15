import { aiReady } from '../lib/ai';
import { useStore } from '../store';

/**
 * AI 自動配置の接続先。
 *
 * API キーは**このブラウザにだけ**置く。設定 JSON にも完了案件にも書き出さない。
 * 共有フォルダの HTML にキーを埋めると、フォルダを見られる全員が使えてしまうため。
 */
export function AiSettingsPanel() {
  const ai = useStore((s) => s.ai);
  const setAi = useStore((s) => s.setAi);
  const missing = aiReady(ai);
  const rules = ai.houseRules ?? [];

  return (
    <>
      <h3 className="section">AI 自動配置</h3>
      <p className="note">
        使用部品を<b>どの段にどの順で並べるか</b>を AI に決めさせる機能の接続先です。
        座標とクリアランスの検査は機械が持つので、AI の答えがそのまま図の不備にはなりません。
      </p>
      <p className="note warn">
        ⚠ <b>API キーはこのブラウザにだけ保存します。</b>
        設定の JSON 書き出しにも完了案件にも含めません。
        共有フォルダの HTML にキーを埋めると、フォルダを見られる全員が使えてしまうためです。
        <b>人数が増えたら社内にプロキシを立てて、キーはそちらに持たせてください</b>
        （送信先をそのURLに変え、キー欄は空にします）。
      </p>

      <div className="grid2">
        <label className="num">
          <span>送信先</span>
          <input
            type="text"
            value={ai.endpoint}
            placeholder="https://api.anthropic.com/v1/messages"
            onChange={(e) => setAi({ endpoint: e.target.value })}
          />
        </label>
        <label className="num">
          <span>モデル</span>
          <input type="text" value={ai.model} onChange={(e) => setAi({ model: e.target.value })} />
        </label>
      </div>

      <label className="num">
        <span>
          API キー<em>このブラウザにだけ保存</em>
        </span>
        <input
          type="password"
          value={ai.apiKey}
          placeholder="社内プロキシを使うなら空のまま"
          autoComplete="off"
          onChange={(e) => setAi({ apiKey: e.target.value })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={ai.directBrowser}
          onChange={(e) => setAi({ directBrowser: e.target.checked })}
        />
        <span>
          ブラウザから直接 Anthropic を呼ぶ
          <em>社内プロキシ経由なら外してください</em>
        </span>
      </label>

      <p className={`calc${missing ? ' bad' : ''}`}>
        {missing ?? '接続先は設定済みです。各面の画面に「AI 自動配置」が出ます。'}
      </p>

      <h4>この会社での決め事（{rules.length}）</h4>
      <p className="note">
        AI の案を<b>不採用</b>にしたときに書いていただいた内容です。
        <b>次からの依頼に指示として毎回添えます。</b>
        モデルそのものを学習させるものではありません（API 越しに学習はできません）。
        効き方は指示文と同じなので、増えすぎたら整理してください。
      </p>
      {rules.length === 0 ? (
        <p className="note">まだありません。</p>
      ) : (
        <ul className="cutsummary rules">
          {rules.map((r, i) => (
            <li key={i}>
              <span>{r}</span>
              <button
                aria-label="決め事を消す"
                onClick={() => setAi({ houseRules: rules.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
