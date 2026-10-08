import { useEffect, useMemo, useState } from 'react';
import { buildBalloons, cabinetElectra, exportHeatW, plateElectra } from '../lib/dxfExport';
import type { ExportInput } from '../lib/dxfExport';
import type { Project } from '../store';

type Tab = 'cabinet' | 'plate';

/**
 * 完了案件の完成図をその場で見る窓。
 *
 * どんな機器構成だったかを、DXF を落として CAD で開かなくても確かめられるようにする。
 * 絵は設計完了のときに出す図そのもの（ElectraCAD 用のシートと同じ描画命令）なので、
 * キャビネットには風船番号と部品表、中板にはダクト・レール・機器・加工が入る。
 * 部品・ダクトは完了時に固めた写しで読むので、あとでマスタを直しても変わらない。
 */
export function ProjectPreview({
  project,
  input,
  onClose,
}: {
  project: Project;
  /** 完了時に固めた部品・ダクトで組んだ書き出し用の入力 */
  input: ExportInput;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('cabinet');
  const [zoom, setZoom] = useState(1);

  // 図は開いたときに 1 回だけ組む（風船・部品表・発熱の注記も設計完了と同じ）
  const sheets = useMemo(() => {
    const balloons = buildBalloons(input);
    const heat = Math.round(exportHeatW(input) * 10) / 10;
    return {
      cabinet: cabinetElectra(input, 'full', balloons, heat),
      plate: plateElectra(input, 'full', heat),
    };
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheet = sheets[tab];
  const title = [project.company, project.jobNo, project.completedAt].filter(Boolean).join('　');

  return (
    <div className="preview-overlay" onClick={onClose} role="dialog" aria-label="完成図">
      <div className="preview" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <strong>{title || '（案件情報なし）'}</strong>
          <span className="muted">
            {project.panel.model || '盤の型式なし'}　{project.panel.outer.w}×{project.panel.outer.h}×D
            {project.panel.outer.d}
          </span>
          <div className="tabs">
            <button className={tab === 'cabinet' ? 'on' : undefined} onClick={() => setTab('cabinet')}>
              キャビネット（風船番号つき）
            </button>
            <button className={tab === 'plate' ? 'on' : undefined} onClick={() => setTab('plate')}>
              中板
            </button>
          </div>
          <label className="zoom">
            <span>拡大</span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span>{Math.round(zoom * 100)}%</span>
          </label>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="preview-body">
          {/* SVG はこちらで組んだ文字列（文字はエスケープ済み）。実寸 mm の viewBox なので幅だけ指定して拡縮する */}
          <div
            className="sheet"
            style={{ width: `${zoom * 100}%` }}
            dangerouslySetInnerHTML={{ __html: sheet.svg }}
          />
        </div>
        <div className="preview-foot">
          {sheet.title}　実寸 {Math.round(sheet.extent.w)}×{Math.round(sheet.extent.h)} mm ／ Esc か外側のクリックで閉じる
        </div>
      </div>
    </div>
  );
}
