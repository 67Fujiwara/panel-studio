import type { ReactNode } from 'react';

/**
 * ふだんは小さなアイコン、載せると大きく出る手引き。
 *
 * 「どこを見ればいいか」は最初の1回しか要らない情報なのに、
 * 画面に常時大きく出しておくと毎日邪魔になる。かといって説明文だけだと
 * メーカーサイトのどのボタンかは伝わらない。so アイコンに畳んでおく。
 */
export function HintIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="hint" tabIndex={0} aria-label={label}>
      <span className="hint-mark" aria-hidden="true">
        ?
      </span>
      <span className="hint-pop" role="tooltip">
        <b>{label}</b>
        {children}
      </span>
    </span>
  );
}

/**
 * メーカーの図面ダウンロード画面のどれを落とすか。
 *
 * 実際のサイトの画面写真ではなく描き起こし。文字が潰れないのと、
 * 先方の画面が変わっても「穴加工用図面の PDF」という要点は変わらないため。
 */
export function DownloadHint() {
  const btn = (x: number, y: number, w: number, label: string, on = false) => (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={20}
        rx={3}
        fill={on ? '#e8453c' : '#2f9e5e'}
        stroke={on ? '#7a1610' : 'none'}
        strokeWidth={on ? 2 : 0}
      />
      <text x={x + w / 2} y={y + 14} fontSize={11} fill="#fff" textAnchor="middle">
        {label}
      </text>
    </>
  );
  return (
    <>
      <svg viewBox="0 0 330 190" className="hint-fig">
        <rect x={0} y={0} width={330} height={190} rx={6} fill="#fff" stroke="#dfe4ea" />
        <rect x={0} y={0} width={330} height={22} rx={6} fill="#e8407a" />
        <text x={165} y={16} fontSize={12} fill="#fff" textAnchor="middle" fontWeight="700">
          図面ダウンロード
        </text>
        <text x={12} y={42} fontSize={12} fill="#1d2530" fontWeight="700">
          ● 型式（例 RA30-65）
        </text>

        <text x={12} y={72} fontSize={11} fill="#6b7684">
          納入仕様書
        </text>
        {btn(150, 60, 62, 'DXF')}
        {btn(220, 60, 62, 'PDF')}

        <text x={12} y={106} fontSize={11} fill="#1d2530" fontWeight="700">
          穴加工用図面
        </text>
        {btn(150, 94, 62, 'DXF')}
        {btn(220, 94, 62, 'PDF', true)}
        <text x={288} y={108} fontSize={16} fill="#e8453c" fontWeight="700">
          ←
        </text>

        <text x={12} y={140} fontSize={11} fill="#6b7684">
          3D CADデータ
        </text>
        {btn(150, 128, 62, 'STEP')}
        {btn(220, 128, 62, '3D PDF')}

        <text x={12} y={172} fontSize={10} fill="#6b7684">
          ※ ポップアップブロックは無効にしておく
        </text>
      </svg>
      <span className="hint-text">
        メーカーの図面ダウンロード画面で<b>「穴加工用図面」の PDF</b>です。
        これが加工有効範囲図（ハッチングの図）にあたります。
        納入仕様書のほうではありません。
      </span>
    </>
  );
}

/**
 * 奥行きの内訳をどこで見るか。
 *
 * 「背面→中板上面」と「扉裏の突出」は言葉だけだと取り違えやすいので、
 * 断面の絵で示す。実物を測るときの目安にもなる。
 */
export function DepthHint() {
  return (
    <>
      <svg viewBox="0 0 330 180" className="hint-fig">
        <rect x={0} y={0} width={330} height={180} fill="#fff" />
        {/* 盤の断面（横から見たところ） */}
        <rect x={40} y={30} width={230} height={110} fill="none" stroke="#1d2530" strokeWidth={2} />
        {/* 中板 */}
        <rect x={95} y={34} width={7} height={102} fill="#6b7684" />
        <text x={98} y={155} fontSize={10} fill="#6b7684" textAnchor="middle">
          中板
        </text>
        {/* 扉 */}
        <rect x={262} y={30} width={8} height={110} fill="#6b7684" />
        <text x={266} y={155} fontSize={10} fill="#6b7684" textAnchor="middle">
          扉
        </text>
        {/* 扉裏の機器 */}
        <rect x={238} y={60} width={24} height={26} fill="#4f6bed" fillOpacity={0.5} />

        {/* 背面→中板上面 */}
        <line x1={40} y1={20} x2={102} y2={20} stroke="#c0392b" strokeWidth={1.5} />
        <line x1={40} y1={16} x2={40} y2={24} stroke="#c0392b" strokeWidth={1.5} />
        <line x1={102} y1={16} x2={102} y2={24} stroke="#c0392b" strokeWidth={1.5} />
        <text x={71} y={12} fontSize={10} fill="#c0392b" textAnchor="middle">
          背面→中板上面
        </text>

        {/* 扉裏の突出 */}
        <line x1={238} y1={168} x2={270} y2={168} stroke="#c0392b" strokeWidth={1.5} />
        <line x1={238} y1={164} x2={238} y2={172} stroke="#c0392b" strokeWidth={1.5} />
        <line x1={270} y1={164} x2={270} y2={172} stroke="#c0392b" strokeWidth={1.5} />
        <text x={254} y={162} fontSize={10} fill="#c0392b" textAnchor="middle">
          扉裏の突出
        </text>

        {/* 有効奥行き */}
        <line x1={102} y1={105} x2={238} y2={105} stroke="#2f6fd0" strokeWidth={1.5} />
        <line x1={102} y1={101} x2={102} y2={109} stroke="#2f6fd0" strokeWidth={1.5} />
        <line x1={238} y1={101} x2={238} y2={109} stroke="#2f6fd0" strokeWidth={1.5} />
        <text x={170} y={100} fontSize={11} fill="#2f6fd0" textAnchor="middle" fontWeight="700">
          有効奥行き（この2つを引いた残り）
        </text>
      </svg>
      <span className="hint-text">
        メーカーの図面ダウンロード画面の<b>「納入仕様書」の PDF</b>（製品外形図・仕様書）で
        確かめます。<b>メーカー図面の値が実物と合わないことがある</b>ので、
        既定値は置かず毎回入れ直す作りにしています。
      </span>
    </>
  );
}
