import type { FaceId, MountType, PanelSpec } from '../types';

export type FaceDef = {
  id: FaceId;
  label: string;
  /** 配線ダクトを敷く面かどうか。中板だけが true。 */
  ducts: boolean;
  /** その面で許可する取付方式 */
  mounts: MountType[];
  /** 面選択画面での配置（三角法に合わせる） */
  grid: { col: number; row: number };
  hint: string;
};

/**
 * 制御盤の6面。
 * 中板だけが配線ダクトを持ち、自動段組みの対象になる。
 * それ以外の面は機器を直接取り付け、穴あけ・切り欠き加工の対象になる。
 */
export const FACES: FaceDef[] = [
  { id: 'top', label: '上面', ducts: false, mounts: ['direct'], grid: { col: 2, row: 1 }, hint: '換気ファン・ルーバー' },
  { id: 'left', label: '左側面', ducts: false, mounts: ['direct'], grid: { col: 1, row: 2 }, hint: '直付け・加工' },
  { id: 'door', label: '正面（扉）', ducts: false, mounts: ['direct'], grid: { col: 2, row: 2 }, hint: '表示器・操作スイッチ' },
  { id: 'right', label: '右側面', ducts: false, mounts: ['direct'], grid: { col: 3, row: 2 }, hint: '換気ファン・ルーバー' },
  { id: 'bottom', label: '底面', ducts: false, mounts: ['direct'], grid: { col: 2, row: 3 }, hint: 'ケーブルグランド' },
  { id: 'plate', label: '中板', ducts: true, mounts: ['din', 'direct'], grid: { col: 2, row: 4 }, hint: '盤内機器・自動配置' },
];

export const FACE_BY_ID = new Map(FACES.map((f) => [f.id, f]));

export const FACE_LABEL = (id: FaceId) => FACE_BY_ID.get(id)?.label ?? id;

/** 盤の外形と中板寸法から、各面の作図寸法を導く。 */
export function faceSize(panel: PanelSpec, face: FaceId): { w: number; h: number } {
  switch (face) {
    case 'plate':
      return { ...panel.plate };
    case 'door':
      return { w: panel.outer.w, h: panel.outer.h };
    case 'left':
    case 'right':
      return { w: panel.outer.d, h: panel.outer.h };
    case 'top':
    case 'bottom':
      return { w: panel.outer.w, h: panel.outer.d };
  }
}
