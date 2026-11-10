/**
 * ストア（5 スライス）を人の操作の順番で通す。
 * 机にしまう・切り替える・設計完了・複製・新規作成が、互いの状態を壊さないことを確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../src/store';

const reset = () => {
  // テストごとに机を白紙へ。マスタは既定値のまま
  useStore.getState().newDesign();
  useStore.setState({ drafts: [], projects: [], currentDraftId: null });
};

describe('ストアの組み合わせ（案件のしまい方と机）', () => {
  beforeEach(reset);

  it('機器を足して寄せ、作業中案件にしまい、新しい机を開いても元の案件へ戻れる', () => {
    const s = useStore.getState();
    s.setPanel({ model: 'TEST-600' });
    s.confirmSize();
    s.openFace('plate');
    s.addDevice('mccb-3p-60a', 2);
    s.addDevice('terminal-ut25', 4);
    const tb = useStore.getState().items.find((i) => i.specId === 'terminal-ut25')!;
    s.pin({ uid: tb.uid, specId: tb.specId, face: 'plate', mount: 'din', x: 300, y: 400, row: 0, pinned: true, onRail: true });
    s.setDuctGap(1, { above: 30 });
    s.saveDraft('案件 A');
    const a = useStore.getState().drafts[0]!;
    expect(a.name).toBe('案件 A');
    expect(a.items).toHaveLength(6);
    expect(a.pinned).toHaveLength(1);
    expect(a.profile.duct.ductGaps[1]).toEqual({ above: 30 });

    // 新しい机。サイドバーの設定（ダクトの余白）は白紙、机も白紙
    s.newDraft();
    expect(useStore.getState().items).toHaveLength(0);
    expect(useStore.getState().profile.duct.ductGaps).toEqual({});
    expect(useStore.getState().currentDraftId).toBeNull();

    // 元の案件へ戻すと、機器・座標置き・余白がそのまま
    useStore.getState().switchDraft(a.id);
    const back = useStore.getState();
    expect(back.items).toHaveLength(6);
    expect(back.pinned[0]).toMatchObject({ x: 300, onRail: true });
    expect(back.profile.duct.ductGaps[1]).toEqual({ above: 30 });
    expect(back.sizeLocked).toBe(true);
  });

  it('設計完了で完了案件に残り、机は白紙に戻る。複製すると当時の内容で机に戻る', () => {
    const s = useStore.getState();
    s.setPanel({ model: 'TEST-600' });
    s.setDepth({ backToPlate: 40, doorProjection: 60 });
    s.confirmSize();
    s.openFace('plate');
    s.addDevice('contactor-st12', 3);
    s.completeDesign({ company: '会社', jobNo: 'J-1', owner: '担当', completedAt: '2026-11-10', note: '' });
    const after = useStore.getState();
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]!.items).toHaveLength(3);
    // 完了時点の部品の写し（使ったものだけ）
    expect(after.projects[0]!.devices?.map((d) => d.id)).toEqual(['contactor-st12']);
    expect(after.items).toHaveLength(0);
    expect(after.screen).toBe('projects');
    expect(after.sizeLocked).toBe(false);

    after.repeatProject(after.projects[0]!.id);
    const rep = useStore.getState();
    expect(rep.items).toHaveLength(3);
    expect(rep.panel.model).toBe('TEST-600');
    expect(rep.sizeLocked).toBe(true);
    expect(rep.screen).toBe('faces');
  });

  it('新規作成は案件ごとの設定を初期化し、決め事（レールの余長・冷却の定数・ダクト幅）は残す', () => {
    const s = useStore.getState();
    s.setRail({ endMargin: 30 });
    s.setCoolingConsts({ margin: 1.5 });
    s.setDuct({ width: 60, rowCount: 5 });
    s.setClearance({ deviceToPlateEdge: 12 });
    s.setDuctGap(2, { below: 40 });
    s.nudgeRail('0:0', 'right', 10, null);
    s.newDesign();
    const p = useStore.getState().profile;
    expect(p.rail.endMargin).toBe(30);
    expect(p.rail.adjust).toEqual({});
    expect(p.cooling?.consts?.margin).toBe(1.5);
    expect(p.cooling?.input).toBeUndefined();
    expect(p.duct.width).toBe(60);
    expect(p.duct.rowCount).toBe(3);
    expect(p.duct.ductGaps).toEqual({});
    expect(p.clearance.deviceToPlateEdge).toBe(0);
  });

  it('部品を消すと机の上の同じ部品も消え、分類を消しても部品は「その他」に残る', () => {
    const s = useStore.getState();
    s.confirmSize();
    s.openFace('plate');
    s.addDevice('relay-g7t', 2);
    s.removePart('relay-g7t');
    expect(useStore.getState().items).toHaveLength(0);
    expect(useStore.getState().devices.some((d) => d.id === 'relay-g7t')).toBe(false);
    s.removeCategory('relay');
    expect(useStore.getState().devices.find((d) => d.id === 'relay-my2n')?.category).toBe('other');
  });

  it('ダクトの微調整とレールの手直しはストア経由でも同じ答えになる（理由の案内も出る）', () => {
    const s = useStore.getState();
    s.confirmSize();
    s.openFace('plate');
    s.addDevice('mccb-3p-60a', 2);
    s.setItemRow('mccb-3p-60a', 0);
    s.addDevice('terminal-ut25', 4);
    s.setItemRow('terminal-ut25', 1);
    // 遮断器（下の離隔 20）の下のダクト 1 を ↑ → 動かず理由が出る
    s.nudgeDuct(1, 0, 1);
    expect(useStore.getState().nudgeNote).toContain('NF63-SV 3P 60A');
    expect(useStore.getState().profile.duct.ductGaps[1]).toBeUndefined();
    // ↓ は動く（上の余白は効いている 20 を基準に 21）
    s.nudgeDuct(1, 0, -1);
    expect(useStore.getState().profile.duct.ductGaps[1]).toEqual({ above: 21, below: 14 });
    expect(useStore.getState().nudgeNote).toBeNull();
    // レールの端
    s.selectRail({ key: '0:0', end: 'right', row: 0 });
    expect(useStore.getState().nudgeNote).toContain('右端を選びました');
    s.nudgeRail('0:0', 'right', 5, null);
    expect(useStore.getState().profile.rail.adjust?.['0:0']).toEqual({ right: 5 });
  });
});
