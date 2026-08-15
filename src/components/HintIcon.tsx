import type { ReactNode } from 'react';

/**
 * ふだんは小さなアイコン、載せると大きく出る手引き。
 *
 * 「どこを見ればいいか」は最初の1回しか要らない情報なのに、
 * 画面に常時大きく出しておくと毎日邪魔になる。かといって説明文だけだと
 * メーカーサイトのどのボタンかは伝わらない。so アイコンに畳んでおく。
 */
export function HintIcon({
  label,
  wide,
  children,
}: {
  label: string;
  /** 図を横に並べる手引き用。中身の幅に合わせて広げる */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="hint" tabIndex={0} aria-label={label}>
      <span className="hint-mark" aria-hidden="true">
        ?
      </span>
      <span className={`hint-pop${wide ? ' wide' : ''}`} role="tooltip">
        <b>{label}</b>
        {children}
      </span>
    </span>
  );
}

/** ダウンロード画面のどの行を指すか。 */
type Row = 'spec' | 'hole';

/**
 * メーカーの図面ダウンロード画面の描き起こし。指定した行の PDF ボタンを赤で囲って示す。
 *
 * 画面写真ではなく描き起こしにしてある。文字が潰れないのと、先方の画面が変わっても
 * 「どの図面を落とすか」という要点は変わらないため。
 * 行の並びと呼び名は実際の画面に合わせてある（探すときに目で照合できるように）。
 */
function DownloadDialog({ highlight }: { highlight: Row }) {
  const rows: { id: string; label: string; sub?: string; btns: string[] }[] = [
    { id: 'spec', label: '納入仕様書', sub: '製品外形図・仕様書', btns: ['DXF', 'PDF'] },
    { id: 'hole', label: '穴加工用図面', sub: 'キャビスタ用', btns: ['DXF', 'PDF'] },
    { id: 'cad3d', label: '3D CADデータ', btns: ['STEP', '3D PDF'] },
    { id: 'ecad', label: '設計用CADデータ', sub: 'キャビスタ連携用', btns: ['ECAD®', '使い方'] },
  ];
  const top = 78;
  const step = 40;

  return (
    <svg viewBox="0 0 392 268" className="hint-fig">
      <rect x={0} y={0} width={392} height={268} fill="#fff" />
      <rect x={0} y={0} width={340} height={26} fill="#e8407a" />
      <text x={170} y={18} fontSize={13} fill="#fff" textAnchor="middle" fontWeight="700">
        図面ダウンロード
      </text>
      <circle cx={16} cy={46} r={4} fill="#2f6fd0" />
      <text x={26} y={50} fontSize={12} fill="#2f6fd0" fontWeight="700">
        RA30-65
      </text>
      <text x={10} y={68} fontSize={9} fill="#2f6fd0" textDecoration="underline">
        図面データのご利用について
      </text>

      {rows.map((r, i) => {
        const y = top + i * step;
        const on = r.id === highlight;
        return (
          <g key={r.id}>
            <rect x={8} y={y} width={324} height={34} fill="#eaf6ea" stroke="#d3e6d3" />
            <text x={16} y={r.sub ? y + 15 : y + 21} fontSize={11} fontWeight="700" fill="#1d2530">
              {r.label}
            </text>
            {r.sub && (
              <text x={16} y={y + 27} fontSize={8} fill="#6b7684">
                （{r.sub}）
              </text>
            )}
            <circle cx={152} cy={y + 17} r={7} fill="#2f6fd0" />
            <text x={152} y={y + 21} fontSize={9} fill="#fff" textAnchor="middle" fontWeight="700">
              ?
            </text>
            {r.btns.map((b, j) => {
              // 目当てはどの行も2つめ（PDF）の列。囲みは枠だけにして、文字はそのまま読ませる
              const mark = on && j === 1;
              const x = 168 + j * 82;
              return (
                <g key={b}>
                  <rect
                    x={x}
                    y={y + 5}
                    width={76}
                    height={24}
                    rx={3}
                    fill={b === '使い方' ? '#8bbf8b' : '#2f9e5e'}
                  />
                  <text
                    x={x + 38}
                    y={y + 21}
                    fontSize={b.length > 4 ? 10 : 12}
                    fill="#fff"
                    textAnchor="middle"
                    fontWeight="700"
                  >
                    {b}
                  </text>
                  {mark && (
                    <>
                      <rect
                        x={x - 3}
                        y={y + 2}
                        width={82}
                        height={30}
                        rx={5}
                        fill="none"
                        stroke="#e8453c"
                        strokeWidth={2.5}
                      />
                      <text x={342} y={y + 22} fontSize={12} fill="#e8453c" fontWeight="700">
                        ←これ
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      <text x={10} y={252} fontSize={8} fill="#6b7684">
        ※ PDF図面が正しく表示されない場合はポップアップブロックを無効にしてください
      </text>
    </svg>
  );
}

/**
 * 加工有効範囲の数値をどの図面から読むか。
 * 「穴加工用図面」の PDF がハッチングの図（加工有効範囲図）にあたる。
 */
export function DownloadHint() {
  return (
    <>
      <span className="hint-text">
        メーカーの図面ダウンロード画面で<b>「穴加工用図面（キャビスタ用）」の PDF</b>です。
        これが加工有効範囲図（ハッチングの図）にあたります。納入仕様書のほうではありません。
      </span>
      <DownloadDialog highlight="hole" />
    </>
  );
}

/**
 * 奥行きの内訳をどこで見るか。
 *
 * 「どの図面を落とすか」と「その図のどこを測るか」の2枚で示す。
 * ダウンロード画面には似た名前が4行並んでいて、図面名だけ言われても迷う。
 * 「背面→中板上面」と「扉裏の突出」も、言葉だけだと取り違えやすい。
 */
export function DepthHint() {
  return (
    <>
      <span className="hint-text">
        メーカーの図面ダウンロード画面で<b>「納入仕様書（製品外形図・仕様書）」の PDF</b>です。
        その中の側面図・断面図から、右の2つを読みます。
        <b>メーカー図面の値が実物と合わないことがある</b>ので、
        既定値は置かず毎回入れ直す作りにしています。
      </span>
      {/*
        図は横に並べる。縦に積むと画面より高くなってスクロールバーが出入りし、
        そのぶん中身が左右にずれてカーソルがアイコンから外れる（点滅の元になる）。
      */}
      <span className="hint-figs">
        <DownloadDialog highlight="spec" />
        <svg viewBox="0 0 330 190" className="hint-fig">
          <rect x={0} y={0} width={330} height={190} fill="#fff" />
          {/* 盤の断面（横から見たところ） */}
          <rect
            x={40}
            y={30}
            width={230}
            height={110}
            fill="none"
            stroke="#1d2530"
            strokeWidth={2}
          />
          {/* 中板 */}
          <rect x={95} y={34} width={7} height={102} fill="#6b7684" />
          <text x={98} y={152} fontSize={10} fill="#6b7684" textAnchor="middle">
            中板
          </text>
          {/* 扉 */}
          <rect x={262} y={30} width={8} height={110} fill="#6b7684" />
          <text x={288} y={137} fontSize={10} fill="#6b7684" textAnchor="middle">
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
          <line x1={238} y1={166} x2={270} y2={166} stroke="#c0392b" strokeWidth={1.5} />
          <line x1={238} y1={162} x2={238} y2={170} stroke="#c0392b" strokeWidth={1.5} />
          <line x1={270} y1={162} x2={270} y2={170} stroke="#c0392b" strokeWidth={1.5} />
          <text x={254} y={182} fontSize={10} fill="#c0392b" textAnchor="middle">
            扉裏の突出
          </text>

          {/* 有効奥行き。線は実寸の位置、文字は空いているところへ逃がす */}
          <line x1={102} y1={110} x2={238} y2={110} stroke="#2f6fd0" strokeWidth={1.5} />
          <line x1={102} y1={106} x2={102} y2={114} stroke="#2f6fd0" strokeWidth={1.5} />
          <line x1={238} y1={106} x2={238} y2={114} stroke="#2f6fd0" strokeWidth={1.5} />
          <text x={170} y={124} fontSize={9} fill="#2f6fd0" textAnchor="middle" fontWeight="700">
            有効奥行き（この2つを引いた残り）
          </text>
        </svg>
      </span>
    </>
  );
}
