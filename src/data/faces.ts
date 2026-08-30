import type { FaceId, MountType, PanelSpec } from '../types';

export type FaceDef = {
  id: FaceId;
  label: string;
  /** 配線ダクトを敷く面かどうか。中板だけが true。 */
  ducts: boolean;
  /** その面で許可する取付方式 */
  mounts: MountType[];
  hint: string;
};

/**
 * 制御盤の6面。
 * 中板だけが配線ダクトを持ち、自動段組みの対象になる。
 * それ以外の面は機器を直接取り付け、穴あけ・切り欠き加工の対象になる。
 */
export const FACES: FaceDef[] = [
  { id: 'top', label: '上面', ducts: false, mounts: ['direct'], hint: '換気ファン・ルーバー' },
  { id: 'left', label: '左側面', ducts: false, mounts: ['direct'], hint: '直付け・加工' },
  { id: 'door', label: '正面（扉）', ducts: false, mounts: ['direct'], hint: '表示器・操作スイッチ' },
  { id: 'right', label: '右側面', ducts: false, mounts: ['direct'], hint: '換気ファン・ルーバー' },
  { id: 'back', label: '背面', ducts: false, mounts: ['direct'], hint: '取付足・引込口' },
  { id: 'bottom', label: '底面', ducts: false, mounts: ['direct'], hint: 'ケーブルグランド' },
  {
    id: 'plate',
    label: '中板',
    ducts: true,
    // 独立レール（din-solo）は中板だけ。他の面はレールを敷かない
    mounts: ['din', 'direct', 'din-solo'],
    hint: '盤内機器・自動配置',
  },
];

export const FACE_BY_ID = new Map(FACES.map((f) => [f.id, f]));

export const FACE_LABEL = (id: FaceId) => FACE_BY_ID.get(id)?.label ?? id;

/** 盤の外形と中板寸法から、各面の作図寸法を導く。 */
export function faceSize(panel: PanelSpec, face: FaceId): { w: number; h: number } {
  switch (face) {
    case 'plate':
      return { ...panel.plate };
    case 'door':
    case 'back':
      return { w: panel.outer.w, h: panel.outer.h };
    case 'left':
    case 'right':
      return { w: panel.outer.d, h: panel.outer.h };
    case 'top':
    case 'bottom':
      return { w: panel.outer.w, h: panel.outer.d };
  }
}
