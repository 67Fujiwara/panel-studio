/** 配置計算の中で受け渡す型。画面側が使うのは DeviceLookup と LayoutItem。 */
import type { DeviceSpec, FaceId, MountSide, MountType, Rotation } from '../../types';

/** 型式ID から機器仕様を引く。共通の部品表と My部品をまとめたもの。 */
export type DeviceLookup = Map<string, DeviceSpec>;

export type LayoutItem = {
  uid: string;
  specId: string;
  face: FaceId;
  mount: MountType;
  /** 何段目に置くかの指定。未指定なら順番に流し込む */
  row?: number;
  /** 向き(0/90/180/270)。図の上でダブルクリックすると回る */
  rot?: Rotation;
  /** この1台に重ねて付ける OP（DINレール取付アタッチメントなど）の specId */
  opts?: string[];
  /** DIN アタッチメントで取付方式を切り替える前の方式。OP を外したらここへ戻す */
  mountBeforeOp?: MountType;
  /** 面の外側か内側か（キャビネットの面だけ）。未指定は外側 */
  side?: MountSide;
  /** 付けた面のほかに、どの面の図にも投影として出すか */
  showOn?: FaceId[];
  /**
   * ゾーン分割のときにどの区画へ置くか（0=左）。未指定なら分類で決める
   * （動力系は左・制御系は右）。図の上でドラッグして区画をまたぐと入る。
   */
  zone?: number;
};

export type Entry = { item: LayoutItem; spec: DeviceSpec };

export type Segment = { x0: number; x1: number };

/** 縦ダクトの帯。左から何本目か（v）を持たせて、1本ずつ型式を切り替えられるようにする。 */
export type VertBand = Segment & { v: number };

/**
 * 段の中で場所を取っている座標置きの機器（矢印キーで寄せた1台など）。
 * 流し込みはここを避けて詰める。避けないと、寄せた1台の跡へ隣が詰まってきて重なる
 */
export type Obstacle = {
  row: number;
  x0: number;
  x1: number;
  stopper: boolean;
  /** 基準線の上下に要る高さ。段の高さに入れ、その段を「使っている段」として数えるため */
  up: number;
  down: number;
};
