import { useState } from 'react';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';

/**
 * OP（重ね付け部品）。
 *
 * インバータの DINレール取付アタッチメントのように、**機器の下に重ねて付く**部品は
 * 独立した配置物として置くと重なり違反になってしまう。so 配置物ではなく
 * 「その1台のオプション」として親にぶら下げる。図では親の下に破線で出て、
 * 親と一緒に動き、BOM には1点ずつ数えられる。
 *
 * OP に DINレール取付品を入れると、その1台は**DIN 取付として扱われる** —
 * レールに座り、直付けの取付穴ケガキも出なくなる。アタッチメントの用途そのもの。
 */
export function OptionPanel({ devices }: { devices: DeviceLookup }) {
  const face = useStore((s) => s.face);
  const selectedUid = useStore((s) => s.selectedUid);
  const items = useStore((s) => s.items);
  const setItemOpts = useStore((s) => s.setItemOpts);
  const [q, setQ] = useState('');

  const item = items.find((i) => i.uid === selectedUid && i.face === face);
  const spec = item ? devices.get(item.specId) : undefined;

  if (!item || !spec) {
    return (
      <p className="note ophint">
        図の機器を選ぶと、<b>OP（重ねて取り付ける部品）</b>を付けられます
        —— DINレール取付アタッチメントなど。
      </p>
    );
  }

  const opts = item.opts ?? [];
  const query = q.trim().toLowerCase();
  const candidates =
    query === ''
      ? []
      : [...devices.values()]
          .filter(
            (d) =>
              d.id !== item.specId &&
              !opts.includes(d.id) &&
              `${d.model} ${d.name} ${d.maker}`.toLowerCase().includes(query),
          )
          .slice(0, 8);

  return (
    <div className="opbox">
      <h2>
        OP（重ね付け） <span className="dim">{spec.model} の選択中の1台</span>
      </h2>
      {opts.length === 0 && (
        <p className="note">
          この1台の下に重ねて付く部品（DINレール取付アタッチメントなど）。
          重なり違反にならず、動かすと一緒に付いてきます。
        </p>
      )}
      {opts.length > 0 && (
        <ul className="oplist">
          {opts.map((id) => {
            const o = devices.get(id);
            return (
              <li key={id}>
                <strong>{o?.model ?? id}</strong>
                <span className="dim">
                  {o ? `${o.size.w}×${o.size.h}×${o.size.d}` : '（マスタに無い部品）'}
                  {o?.mount.includes('din') && ' ・DINレール取付品'}
                </span>
                <button
                  aria-label="OP を外す"
                  onClick={() => setItemOpts(item.uid, opts.filter((x) => x !== id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {opts.some((id) => devices.get(id)?.mount.includes('din')) && (
        <p className="calc">
          DINレール取付品が付いたので、この1台は<b>レールに乗せて</b>扱います
          （直付けの取付穴は出ません）。
        </p>
      )}
      <input
        className="search"
        placeholder="＋ OP を付ける（型式・品名で検索）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {candidates.length > 0 && (
        <ul className="oplist pick">
          {candidates.map((d) => (
            <li key={d.id}>
              <button
                className="linkish"
                onClick={() => {
                  setItemOpts(item.uid, [...opts, d.id]);
                  setQ('');
                }}
              >
                <strong>{d.model}</strong>
                <span className="dim">
                  {d.maker} {d.name} — {d.size.w}×{d.size.h}×{d.size.d}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query !== '' && candidates.length === 0 && (
        <p className="note">見つかりません。部品マスタ（設定 / My部品）に登録してから付けてください。</p>
      )}
    </div>
  );
}
