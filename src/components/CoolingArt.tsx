import type { CoolingEnv, CoolingMethod, MountDef } from '../lib/cooling';

/** 放熱する面の色と、ふさがっている面の色（仕様のとおり） */
const HOT = '#4A90D9';
const BLOCKED = '#B0B0B0';

/**
 * 設置条件の図カード。盤を斜投影の箱（正面・天面・右側面が見える）で描き、
 * 壁・隣盤・天井を足し引きする。放熱する面はアクセント色、接している面はグレー
 */
export function MountArt({ m }: { m: MountDef }) {
  const face = (points: string, blocked: boolean) => (
    <polygon points={points} fill={blocked ? BLOCKED : HOT} fillOpacity={blocked ? 0.6 : 0.35} stroke="#333" strokeWidth={1} />
  );
  // 右側面は右に隣盤があればふさがる（片側の隣盤は右に描く）。天面は天井がふさぐ
  const rightBlocked = m.neighbors >= 1;
  const topBlocked = m.roof;
  return (
    <svg viewBox="0 0 180 190" className="mount-art" aria-hidden="true">
      {m.wall && (
        <>
          <polygon points="40,20 170,20 170,165 40,165" fill="#E0E0E0" stroke="#999" />
          <text x="164" y="34" fontSize="11" fill="#666" textAnchor="end">
            壁
          </text>
        </>
      )}
      {/* 左の隣盤（両側のとき）。正面と天面だけ半分見える */}
      {m.neighbors === 2 && (
        <>
          <polygon points="0,60 50,60 50,170 0,170" fill={BLOCKED} fillOpacity={0.5} stroke="#777" />
          <polygon points="0,60 25,45 75,45 50,60" fill={BLOCKED} fillOpacity={0.5} stroke="#777" />
        </>
      )}
      {/* 右の隣盤（片側・両側） */}
      {m.neighbors >= 1 && (
        <>
          <polygon points="135,45 180,45 180,155 135,155" fill={BLOCKED} fillOpacity={0.5} stroke="#777" />
          <polygon points="110,60 180,60 180,170 110,170" fill={BLOCKED} fillOpacity={0.5} stroke="#777" />
        </>
      )}
      {/* 盤 */}
      {face('50,60 110,60 110,170 50,170', false)}
      {face('50,60 75,45 135,45 110,60', topBlocked)}
      {face('110,60 135,45 135,155 110,170', rightBlocked)}
      {/* 天井 */}
      {m.roof && (
        <>
          <polygon points="44,44 69,29 141,29 116,44" fill="#D5D5D5" stroke="#999" />
          <text x="150" y="40" fontSize="11" fill="#666" textAnchor="end">
            天井
          </text>
        </>
      )}
    </svg>
  );
}

/** 設置環境のアイコン。清浄＝工場の屋内、粉塵＝粒、油煙・水気＝しずく、屋外＝太陽と雨 */
export function EnvArt({ id }: { id: CoolingEnv }) {
  switch (id) {
    case 'clean':
      return (
        <svg viewBox="0 0 120 90" className="env-art" aria-hidden="true">
          <polygon points="10,80 10,40 35,25 35,40 60,25 60,40 85,25 85,80" fill="#E8F0FA" stroke="#4A90D9" strokeWidth={2} />
          <rect x="88" y="20" width="10" height="60" fill="#E8F0FA" stroke="#4A90D9" strokeWidth={2} />
          <path d="M100 30 l4 -8 l4 8 l-4 8z M106 14 l2 -5 l2 5 l-2 5z" fill="#4A90D9" />
        </svg>
      );
    case 'dust':
      return (
        <svg viewBox="0 0 120 90" className="env-art" aria-hidden="true">
          {(
            [
              [20, 25, 3], [40, 15, 2], [55, 35, 4], [75, 20, 2.5], [95, 30, 3], [30, 55, 2], [60, 60, 3], [85, 55, 2], [105, 65, 2.5], [45, 75, 2.5], [15, 70, 3], [100, 10, 2],
            ] as [number, number, number][]
          ).map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#8A7A5A" fillOpacity={0.8} />
          ))}
        </svg>
      );
    case 'oil_water':
      return (
        <svg viewBox="0 0 120 90" className="env-art" aria-hidden="true">
          {(
            [
              [30, 30], [60, 20], [90, 35], [45, 60], [75, 65],
            ] as [number, number][]
          ).map(([x, y], i) => (
            <path key={i} d={`M${x} ${y - 14} q10 14 0 24 q-10 -10 0 -24z`} fill="#4A90D9" fillOpacity={0.6} stroke="#2F6FB3" />
          ))}
        </svg>
      );
    case 'outdoor':
      return (
        <svg viewBox="0 0 120 90" className="env-art" aria-hidden="true">
          <circle cx="30" cy="28" r="12" fill="#F5B301" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1={30 + 16 * Math.cos((a * Math.PI) / 180)} y1={28 + 16 * Math.sin((a * Math.PI) / 180)} x2={30 + 22 * Math.cos((a * Math.PI) / 180)} y2={28 + 22 * Math.sin((a * Math.PI) / 180)} stroke="#F5B301" strokeWidth={2} />
          ))}
          <path d="M60 40 q8 -16 24 -10 q14 -6 20 8 q10 2 6 12 h-50 q-8 -2 0 -10z" fill="#DDE4EC" stroke="#8A9AAE" />
          {[66, 78, 90, 102].map((x, i) => (
            <line key={i} x1={x} y1={58} x2={x - 4} y2={74} stroke="#4A90D9" strokeWidth={2} />
          ))}
        </svg>
      );
  }
}

/** 盤サイズ入力の図。W・H・D の寸法線を付けた斜投影の箱 */
export function SizeArt() {
  return (
    <svg viewBox="0 0 220 200" className="size-art" aria-hidden="true">
      <polygon points="40,60 140,60 140,180 40,180" fill={HOT} fillOpacity={0.25} stroke="#333" />
      <polygon points="40,60 80,30 180,30 140,60" fill={HOT} fillOpacity={0.25} stroke="#333" />
      <polygon points="140,60 180,30 180,150 140,180" fill={HOT} fillOpacity={0.25} stroke="#333" />
      {/* W */}
      <line x1="40" y1="192" x2="140" y2="192" stroke="#333" />
      <text x="90" y="189" fontSize="12" textAnchor="middle" fill="#333">
        W
      </text>
      {/* H */}
      <line x1="26" y1="60" x2="26" y2="180" stroke="#333" />
      <text x="18" y="124" fontSize="12" textAnchor="middle" fill="#333">
        H
      </text>
      {/* D */}
      <line x1="150" y1="186" x2="190" y2="156" stroke="#333" />
      <text x="178" y="180" fontSize="12" fill="#333">
        D
      </text>
    </svg>
  );
}

/** 外気温と目標温度を並べた温度計。差を大きく見せる */
export function ThermoArt({ ta, ti }: { ta: number; ti: number }) {
  const lo = -20;
  const hi = 70;
  const y = (t: number) => 150 - ((Math.max(lo, Math.min(hi, t)) - lo) / (hi - lo)) * 130;
  const bar = (x: number, t: number, color: string, label: string) => (
    <g>
      <rect x={x - 8} y={20} width={16} height={130} rx={8} fill="#eee" stroke="#bbb" />
      <rect x={x - 6} y={y(t)} width={12} height={150 - y(t)} rx={6} fill={color} />
      <circle cx={x} cy={160} r={12} fill={color} />
      <text x={x} y={175 + 12} fontSize="11" textAnchor="middle" fill="#444">
        {label}
      </text>
      <text x={x} y={y(t) - 6} fontSize="12" textAnchor="middle" fill="#222" fontWeight={700}>
        {t}℃
      </text>
    </g>
  );
  const dT = ti - ta;
  return (
    <svg viewBox="0 0 200 200" className="thermo-art" aria-hidden="true">
      {bar(50, ta, '#E67E22', '外気温 Ta')}
      {bar(110, ti, '#4A90D9', '目標温度 Ti')}
      <text x="165" y="80" fontSize="11" textAnchor="middle" fill="#666">
        差 Ti−Ta
      </text>
      <text x="165" y="110" fontSize="26" textAnchor="middle" fill={dT > 0 ? '#1f7a3a' : '#c0392b'} fontWeight={700}>
        {dT > 0 ? '+' : ''}
        {dT}
      </text>
      <text x="165" y="128" fontSize="11" textAnchor="middle" fill="#666">
        K
      </text>
    </svg>
  );
}

/** 推奨方式のアイコン */
export function MethodArt({ method }: { method: CoolingMethod }) {
  switch (method) {
    case 'none':
      return (
        <svg viewBox="0 0 60 60" className="method-art" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="#E6F4EA" stroke="#1f7a3a" strokeWidth={2} />
          <path d="M17 31 l9 9 l17 -19" fill="none" stroke="#1f7a3a" strokeWidth={4} strokeLinecap="round" />
        </svg>
      );
    case 'fan':
      return (
        <svg viewBox="0 0 60 60" className="method-art" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="#E8F0FA" stroke="#2F6FB3" strokeWidth={2} />
          {[0, 120, 240].map((a) => (
            <path key={a} d="M30 30 q14 -18 4 -24 q-6 8 -4 24z" fill="#2F6FB3" transform={`rotate(${a} 30 30)`} />
          ))}
          <circle cx="30" cy="30" r="4" fill="#2F6FB3" />
        </svg>
      );
    case 'heat_exchanger':
      return (
        <svg viewBox="0 0 60 60" className="method-art" aria-hidden="true">
          <rect x="6" y="8" width="48" height="44" rx="6" fill="#FFF4E0" stroke="#B9770E" strokeWidth={2} />
          <path d="M14 22 h26 m-6 -6 l6 6 l-6 6" fill="none" stroke="#B9770E" strokeWidth={3} strokeLinecap="round" />
          <path d="M46 38 h-26 m6 -6 l-6 6 l6 6" fill="none" stroke="#2F6FB3" strokeWidth={3} strokeLinecap="round" />
        </svg>
      );
    case 'cooler':
      return (
        <svg viewBox="0 0 60 60" className="method-art" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="#E8F4FA" stroke="#1B6CA8" strokeWidth={2} />
          {[0, 60, 120].map((a) => (
            <g key={a} transform={`rotate(${a} 30 30)`}>
              <line x1="30" y1="10" x2="30" y2="50" stroke="#1B6CA8" strokeWidth={3} strokeLinecap="round" />
              <path d="M30 14 l-5 5 m5 -5 l5 5 M30 46 l-5 -5 m5 5 l5 -5" fill="none" stroke="#1B6CA8" strokeWidth={2} strokeLinecap="round" />
            </g>
          ))}
        </svg>
      );
  }
}
