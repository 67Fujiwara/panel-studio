import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/** 「いつしまったか」を人の言葉で。時刻まで出すと一覧が読みにくい。 */
function whenLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const now = new Date();
  const sameDay = t.toDateString() === now.toDateString();
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return hhmm;
  const yst = new Date(now);
  yst.setDate(now.getDate() - 1);
  if (t.toDateString() === yst.toDateString()) return `昨日 ${hhmm}`;
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

/**
 * 作業中案件の切り替え。
 *
 * 実務では「A の途中で B を急ぎで見てくれ」が普通に起きる。そのたびに
 * 設計完了させたり JSON を書き出したりせずに済むよう、**途中の机ごと**しまって
 * 別の案件へ移れるようにする。
 *
 * 切り替え・新規のときは**いまの机を自動でしまう**。しまい忘れで作りかけが
 * 消えるのがいちばん困るので、ボタンを押させない。
 */
export function DraftSwitcher() {
  const drafts = useStore((s) => s.drafts);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const panelModel = useStore((s) => s.panel.model);
  const itemCount = useStore((s) => s.items.length);
  const saveDraft = useStore((s) => s.saveDraft);
  const switchDraft = useStore((s) => s.switchDraft);
  const newDraft = useStore((s) => s.newDraft);
  const renameDraft = useStore((s) => s.renameDraft);
  const removeDraft = useStore((s) => s.removeDraft);

  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 外を押したら閉じる。Esc でも閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cur = drafts.find((d) => d.id === currentDraftId);
  const label = cur?.name ?? (panelModel.trim() || '無題の設計');
  // まだ一度もしまっていない机には印を出す。閉じたら消える状態だと分かるように
  const unsaved = !cur && (itemCount > 0 || panelModel.trim() !== '');

  return (
    <div className="drafts" ref={boxRef}>
      <button
        className={`draftbtn${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="作業中の案件を切り替える"
      >
        <span className="draftname">{label}</span>
        {unsaved && <em className="dot" title="まだ一時保存していません" />}
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="draftmenu">
          <div className="draftmenu-head">作業中の案件</div>
          <ul>
            {drafts.map((d) => (
              <li key={d.id} className={d.id === currentDraftId ? 'on' : undefined}>
                <button
                  className="pick"
                  onClick={() => {
                    switchDraft(d.id);
                    setOpen(false);
                  }}
                  title="この案件に切り替える（いまの設計は自動でしまいます）"
                >
                  <span className="nm">{d.name}</span>
                  <span className="when">{whenLabel(d.savedAt)}</span>
                </button>
                <button
                  className="mini"
                  aria-label="名前を変える"
                  title="名前を変える"
                  onClick={() => {
                    const v = window.prompt('案件の名前', d.name);
                    if (v !== null && v.trim()) renameDraft(d.id, v.trim());
                  }}
                >
                  名
                </button>
                <button
                  className="mini"
                  aria-label="この案件を削除"
                  title="この案件を削除する"
                  onClick={() => {
                    if (window.confirm(`「${d.name}」を作業中から削除します。よろしいですか？`))
                      removeDraft(d.id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {drafts.length === 0 && <li className="empty">まだありません</li>}
          </ul>
          <div className="draftmenu-foot">
            <button
              onClick={() => {
                const v = window.prompt('この設計に名前を付けてしまいます', label);
                if (v === null) return;
                saveDraft(v.trim() || label);
                setOpen(false);
              }}
            >
              いまの設計をしまう
            </button>
            <button
              className="primary"
              onClick={() => {
                newDraft();
                setOpen(false);
              }}
              title="いまの設計をしまって、白紙で始めます"
            >
              ＋ 別の案件を始める
            </button>
          </div>
          <p className="draftmenu-note">
            切り替えと「別の案件を始める」では、<b>いまの設計は自動でしまわれます</b>。
            設計完了した案件は作業中から外れて完了案件へ移ります。
          </p>
        </div>
      )}
    </div>
  );
}
