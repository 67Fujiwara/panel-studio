import { useMemo, useState } from 'react';
import { FACES } from '../data/faces';
import { buildBom } from '../lib/bom';
import { autoLayout } from '../lib/layout';
import { downloadJson, pickJson } from '../lib/jsonFile';
import { buildDxfSet, downloadDxfSet } from '../lib/dxfExport';
import { asciiFileName } from '../lib/csv';
import { deviceLookup, useStore, type ProjectFile } from '../store';
import type { Project } from '../store';

/** その案件の機器点数と型式数。一覧で規模がつかめるようにする。 */
function scaleOf(p: Project) {
  const models = new Set(p.items.map((i) => i.specId));
  return { qty: p.items.length, kinds: models.size };
}

/**
 * 設計完了した案件の一覧。
 *
 * 過去の案件を振り返るためと、似た盤をもう一度作る（複製）ための画面。
 * 誰が設計したかが分かるよう担当者を必ず持たせる。
 */
export function ProjectsScreen() {
  const projects = useStore((s) => s.projects);
  const devices = useStore((s) => s.devices);
  const myDevices = useStore((s) => s.myDevices);
  const ducts = useStore((s) => s.ducts);
  const repeatProject = useStore((s) => s.repeatProject);
  const updateProject = useStore((s) => s.updateProject);
  const removeProject = useStore((s) => s.removeProject);
  const loadProjectFile = useStore((s) => s.loadProjectFile);

  const [open, setOpen] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);

  const owners = [...new Set(projects.map((p) => p.owner).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const shown = projects.filter(
    (p) =>
      (!owner || p.owner === owner) &&
      (!q ||
        p.company.toLowerCase().includes(q) ||
        p.jobNo.toLowerCase().includes(q) ||
        p.panel.model.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)),
  );

  /** その案件の BOM。開いたときだけ組み立てる */
  const bomOf = (p: Project) => {
    const layouts = FACES.map((f) =>
      autoLayout(p.panel, p.profile, f.id, p.items, p.pinned, lookup, p.removedDucts[f.id] ?? []),
    );
    return buildBom(layouts, p.profile, lookup, ducts);
  };

  const exportFile = () => {
    const file: ProjectFile = { schemaVersion: 1, projects };
    downloadJson(file, 'panel-studio-projects.json');
  };
  const importFile = async () => {
    const data = await pickJson<ProjectFile>();
    if (data?.schemaVersion === 1) loadProjectFile(data);
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>完了案件</h2>
        <p className="note">
          「設計完了」で残した案件です。<b>複製</b>を押すと、その案件の盤・設定・機器・加工を
          そのまま読み込んで続きから作れます。似た盤を一から組み直す必要がなくなります。
          <b>DXF</b> はその案件の図面4ファイル（キャビネット／中板 × 機器つき／加工穴のみ）を出します。
        </p>
        <p className="note">
          このブラウザにも残していますが、<b>共有フォルダで引き継ぐときは JSON で書き出して</b>
          ください。他の人の環境では読み込みが必要です。
        </p>
        <div className="row-buttons">
          <button onClick={exportFile} disabled={projects.length === 0}>
            書き出し（JSON）
          </button>
          <button onClick={() => void importFile()}>読み込み（JSON）</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="note">
          まだ登録がありません。<b>面選択</b>画面の「設計完了」で残せます。
        </p>
      ) : (
        <>
          <div className="row-buttons">
            <input
              type="search"
              className="search"
              placeholder="会社名・案件番号・盤の型式・メモで絞り込み"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="sel">
              <span>担当者</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">全員</option>
                {owners.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="tablewrap">
            <table className="encl projects">
              <thead>
                <tr>
                  <th>会社名</th>
                  <th>案件番号</th>
                  <th>日付</th>
                  <th>担当者</th>
                  <th>盤の型式</th>
                  <th>外形</th>
                  <th>機器</th>
                  <th />
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const { qty, kinds } = scaleOf(p);
                  const isOpen = open === p.id;
                  return (
                    <>
                      <tr key={p.id} className={isOpen ? 'on' : undefined}>
                        <td>
                          <button className="linky" onClick={() => setOpen(isOpen ? null : p.id)}>
                            <span className={`caret${isOpen ? ' open' : ''}`} aria-hidden="true" />
                            {p.company || '（会社名なし）'}
                          </button>
                        </td>
                        <td>{p.jobNo || '—'}</td>
                        <td className="qty">{p.completedAt}</td>
                        <td>{p.owner || '—'}</td>
                        <td>{p.panel.model || '—'}</td>
                        <td className="qty">
                          {p.panel.outer.w}×{p.panel.outer.h}×D{p.panel.outer.d}
                        </td>
                        <td className="qty">
                          {qty} 台 / {kinds} 型式
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              void downloadDxfSet(
                                buildDxfSet(
                                  {
                                    panel: p.panel,
                                    profile: p.profile,
                                    items: p.items,
                                    pinned: p.pinned,
                                    machining: p.machining,
                                    removedDucts: p.removedDucts,
                                    devices: lookup,
                                  },
                                  asciiFileName(p.jobNo || p.panel.model, 'panel'),
                                ),
                              )
                            }
                            title="キャビネット／中板 × 機器つき／加工穴のみ の4ファイル"
                          >
                            DXF
                          </button>
                        </td>
                        <td>
                          <button className="primary" onClick={() => repeatProject(p.id)}>
                            複製
                          </button>
                        </td>
                        <td>
                          <button onClick={() => removeProject(p.id)} aria-label="案件を削除">
                            ×
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${p.id}-detail`} className="detail">
                          <td colSpan={10}>
                            <div className="grid4">
                              <label className="num">
                                <span>会社名</span>
                                <input
                                  type="text"
                                  value={p.company}
                                  onChange={(e) => updateProject(p.id, { company: e.target.value })}
                                />
                              </label>
                              <label className="num">
                                <span>案件番号</span>
                                <input
                                  type="text"
                                  value={p.jobNo}
                                  onChange={(e) => updateProject(p.id, { jobNo: e.target.value })}
                                />
                              </label>
                              <label className="num">
                                <span>日付</span>
                                <input
                                  type="date"
                                  value={p.completedAt}
                                  onChange={(e) =>
                                    updateProject(p.id, { completedAt: e.target.value })
                                  }
                                />
                              </label>
                              <label className="num">
                                <span>担当者</span>
                                <input
                                  type="text"
                                  value={p.owner}
                                  onChange={(e) => updateProject(p.id, { owner: e.target.value })}
                                />
                              </label>
                            </div>
                            <label className="num">
                              <span>メモ</span>
                              <input
                                type="text"
                                value={p.note}
                                onChange={(e) => updateProject(p.id, { note: e.target.value })}
                                placeholder="納入先・特記事項など"
                              />
                            </label>
                            <h4>この案件の部品表</h4>
                            <table className="bom">
                              <tbody>
                                {bomOf(p).map((l, i) => (
                                  <tr key={i} className={l.source === 'derived' ? 'derived' : undefined}>
                                    <td>
                                      <strong>{l.model}</strong>
                                    </td>
                                    <td>
                                      {l.maker} / {l.name}
                                    </td>
                                    <td className="qty">
                                      {l.qty}
                                      <em>{l.unit}</em>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="note">条件に合う案件がありません。</p>}
        </>
      )}
    </div>
  );
}
