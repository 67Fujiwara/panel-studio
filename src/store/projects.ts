/** 完了案件と作業中案件。机のしまい方・切り替え・設計完了。 */
import type { StateCreator } from 'zustand';
import { BLANK_PANEL, DEFAULT_PROFILE } from '../data/enclosures';
import { effectiveDepth } from '../lib/layout';
import type { FaceId, Profile } from '../types';
import { nextId } from './shared';
import type { Draft, Project, ProjectFile, ProjectSlice, Screen, State } from './types';


/**
 * 新しい案件を始めるときの設定。
 *
 * 左のサイドバーで案件ごとに動かすもの（ダクトの引き方・段の高さ・段数・中板の端からの余白・
 * ダクトごとの調整・クリアランス）は初期値へ戻す。前の案件の余白やダクトごとの調整が
 * 次の案件に残っていると、新規なのに図が前の案件の癖を引きずる。
 * 「うちはこう作る」の決め事（使うダクトの型式と幅・固定穴・DINレール・BOM の書式）は残す
 */
function freshProjectProfile(profile: Profile): Profile {
  return {
    ...profile,
    duct: {
      ...profile.duct,
      layout: DEFAULT_PROFILE.duct.layout,
      rowHeightMode: DEFAULT_PROFILE.duct.rowHeightMode,
      rowCount: DEFAULT_PROFILE.duct.rowCount,
      margin: { ...DEFAULT_PROFILE.duct.margin },
      ductGaps: {},
      vertGaps: {},
    },
    clearance: structuredClone(DEFAULT_PROFILE.clearance),
    // レールの余長・固定穴は決め事なので残し、レールごとの手直しだけ白紙にする
    rail: { ...profile.rail, adjust: {} },
    // 冷却選定の入力は案件ごと。定数は決め事なので残す
    cooling: profile.cooling?.consts ? { consts: profile.cooling.consts } : undefined,
  };
}

const PROJECT_KEY = 'panel-studio.projects';

const DRAFT_KEY = 'panel-studio.drafts';

/**
 * 過去案件はブラウザにも残す。閉じたら消えるのでは「振り返る」用途を満たせないため。
 * file:// で開くと保存できない環境があるので、失敗しても黙って続ける
 * （JSON 書き出しが本命の受け渡し手段）。
 */
function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    const data = raw ? (JSON.parse(raw) as ProjectFile) : null;
    return data?.schemaVersion === 1 ? data.projects : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ schemaVersion: 1, projects }));
  } catch {
    /* 保存できない環境では JSON 書き出しを使ってもらう */
  }
}

/**
 * 作業中の案件も完了案件と同じくブラウザに残す。
 * 「一時保存」が閉じたら消えるのでは、掛け持ちの用が足りないため。
 */
function loadDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const data = raw ? (JSON.parse(raw) as { schemaVersion: number; drafts: Draft[] }) : null;
    return data?.schemaVersion === 1 ? (data.drafts ?? []) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: Draft[]) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ schemaVersion: 1, drafts }));
  } catch {
    /* 保存できない環境では JSON 書き出しを使ってもらう */
  }
}

/**
 * 完了時に固めるマスタの写し。**その案件で実際に使ったものだけ**を持つ。
 * マスタ全部を複製すると、案件が増えるほどファイルが太る。
 */
function frozenMasters(s: State): Pick<Project, 'devices' | 'categories' | 'ducts'> {
  const used = new Set(s.items.map((i) => i.specId));
  // OP（重ね付け）で足した部品も図と BOM に出るので一緒に固める
  for (const i of s.items) for (const o of i.opts ?? []) used.add(o);
  const devices = [...s.devices, ...s.myDevices].filter((d) => used.has(d.id));
  const cats = new Set(devices.map((d) => d.category));
  return {
    devices: structuredClone(devices),
    categories: structuredClone(s.categories.filter((c) => cats.has(c.id))),
    ducts: structuredClone(s.ducts),
  };
}

/** 白紙の机か。何も置いていないものをしまっても、一覧が「無題」で埋まるだけ。 */
function isBlankDesk(s: State): boolean {
  return (
    s.items.length === 0 &&
    s.machining.length === 0 &&
    Object.keys(s.underlays).length === 0 &&
    !s.panel.model.trim()
  );
}

/**
 * いまの机を作業中案件へしまう。切り替え・新規のたびに通る道なので、
 * 「しまい忘れで作りかけが消える」が起きないよう**自動で**呼ぶ。
 *
 * 白紙の机はしまわない。まだ一度もしまっていなければ新しく作る。
 */
function stashDraft(s: State, name?: string): Partial<State> {
  if (!s.currentDraftId && !name && isBlankDesk(s)) return {};
  const snapshot = {
    face: s.face,
    panel: structuredClone(s.panel),
    profile: structuredClone(s.profile),
    items: structuredClone(s.items),
    pinned: structuredClone(s.pinned),
    machining: structuredClone(s.machining),
    removedDucts: structuredClone(s.removedDucts),
    underlays: structuredClone(s.underlays),
    sizeLocked: s.sizeLocked,
    savedAt: new Date().toISOString(),
  };
  const cur = s.drafts.find((d) => d.id === s.currentDraftId);
  const label = (name ?? cur?.name ?? s.panel.model.trim() ?? '').trim() || '無題の設計';
  const drafts = cur
    ? s.drafts.map((d) => (d.id === cur.id ? { ...d, ...snapshot, name: label } : d))
    : [{ id: nextId('drf'), name: label, ...snapshot }, ...s.drafts];
  saveDrafts(drafts);
  return { drafts, currentDraftId: cur?.id ?? drafts[0]!.id };
}

export const createProjectSlice: StateCreator<State, [], [], ProjectSlice> = (set) => ({

  projects: loadProjects(),

  drafts: loadDrafts(),

  currentDraftId: null,

  newDesign: () =>
    set((s) => ({
      // 案件ごとに選ぶもの（サイドバーの設定）は初期値へ戻す。登録した幅や固定穴は残す
      profile: freshProjectProfile(s.profile),
      panel: structuredClone(BLANK_PANEL),
      items: [],
      pinned: [],
      machining: [],
      underlays: {},
      removedDucts: {},
      selectedUid: null,
      selectedCut: null,
      selectedDuct: null, selectedRail: null,
      aiReview: null,
      aiFeedback: '',
      face: 'plate' as FaceId,
      screen: 'start' as Screen,
      sizeLocked: false,
      // 白紙にしたら、いまの机はどの作業中案件でもなくなる。
      // ここを残すと、次にしまったとき前の案件を白紙で上書きしてしまう
      currentDraftId: null,
    })),

  saveDraft: (name) => set((s) => stashDraft(s, name)),

  autoStash: () => set((s) => stashDraft(s)),

  switchDraft: (id) =>
    set((s) => {
      if (id === s.currentDraftId) return s;
      // いまの机を先にしまう。しまい先が増えることもあるので、その結果から探す
      const stashed = stashDraft(s);
      const drafts = stashed.drafts ?? s.drafts;
      const to = drafts.find((d) => d.id === id);
      if (!to) return stashed;
      return {
        ...stashed,
        panel: structuredClone(to.panel),
        profile: structuredClone(to.profile),
        items: structuredClone(to.items),
        pinned: structuredClone(to.pinned),
        machining: structuredClone(to.machining),
        removedDucts: structuredClone(to.removedDucts),
        underlays: structuredClone(to.underlays),
        // 古い案件は確定の印を持っていない。奥行きまで入っていれば先へ進んでいた案件なので確定済みとみなす
        sizeLocked: to.sizeLocked ?? effectiveDepth(to.panel) !== null,
        face: to.face,
        currentDraftId: to.id,
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null, selectedRail: null,
        aiReview: null,
        aiFeedback: '',
        // しまったときの面へ戻す。中板の続きなら中板が開く
        screen: (effectiveDepth(to.panel) === null ? 'start' : 'layout') as Screen,
      };
    }),

  newDraft: () =>
    set((s) => {
      const stashed = stashDraft(s);
      return {
        ...stashed,
        // 左のサイドバーの設定（ダクト・余白・クリアランス）は初期値へ。作りかけの案件側には残っている
        profile: freshProjectProfile(s.profile),
        panel: structuredClone(BLANK_PANEL),
        items: [],
        pinned: [],
        machining: [],
        underlays: {},
        removedDucts: {},
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null, selectedRail: null,
        aiReview: null,
        aiFeedback: '',
        face: 'plate' as FaceId,
        screen: 'start' as Screen,
        sizeLocked: false,
        currentDraftId: null,
      };
    }),

  renameDraft: (id, name) =>
    set((s) => {
      const drafts = s.drafts.map((d) => (d.id === id ? { ...d, name } : d));
      saveDrafts(drafts);
      return { drafts };
    }),

  removeDraft: (id) =>
    set((s) => {
      const drafts = s.drafts.filter((d) => d.id !== id);
      saveDrafts(drafts);
      if (s.currentDraftId !== id) return { drafts };
      /*
       * 机に出している案件を消したら、机も白紙にする。
       * 以前は「図はそのまま残す」にしていたが、机は変更が止まると自動で作業中案件へ
       * しまわれるので、残した図が1秒後に「無題の設計」として**復活**していた。
       * 消したのに消えない、が実際に起きたので、消すときは机ごと消す
       */
      return {
        drafts,
        currentDraftId: null,
        panel: structuredClone(BLANK_PANEL),
        items: [],
        pinned: [],
        machining: [],
        underlays: {},
        removedDucts: {},
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null, selectedRail: null,
        aiReview: null,
        aiFeedback: '',
        face: 'plate' as FaceId,
        screen: 'start' as Screen,
        sizeLocked: false,
      };
    }),

  completeDesign: (v) =>
    set((s) => {
      const project: Project = {
        id: nextId('prj'),
        company: v.company.trim(),
        jobNo: v.jobNo.trim(),
        owner: v.owner.trim(),
        completedAt: v.completedAt || new Date().toISOString().slice(0, 10),
        note: v.note.trim(),
        // あとで書き換わらないよう、その時点の中身を複製して持つ
        panel: structuredClone(s.panel),
        profile: structuredClone(s.profile),
        items: structuredClone(s.items),
        pinned: structuredClone(s.pinned),
        machining: structuredClone(s.machining),
        removedDucts: structuredClone(s.removedDucts),
        underlays: structuredClone(s.underlays),
        // 使った部品・分類・ダクトも写して固める。以後マスタを直しても図は動かない
        ...frozenMasters(s),
      };
      const projects = [project, ...s.projects];
      saveProjects(projects);
      // 完了した案件は「作業中」から外す。終わったものが掛け持ちの一覧に残ると、
      // どれが生きているのか読めなくなる
      const drafts = s.drafts.filter((d) => d.id !== s.currentDraftId);
      if (drafts.length !== s.drafts.length) saveDrafts(drafts);
      // 完了したら机の上を片付ける。前の案件の盤や機器が残っていると
      // 次の設計に混ざり込むため、盤サイズと面選択を白紙に戻す
      return {
        projects,
        drafts,
        currentDraftId: null,
        profile: {
          ...s.profile,
          duct: {
            ...s.profile.duct,
            layout: DEFAULT_PROFILE.duct.layout,
            rowHeightMode: DEFAULT_PROFILE.duct.rowHeightMode,
            ductGaps: {},
            vertGaps: {},
          },
        },
        panel: structuredClone(BLANK_PANEL),
        items: [],
        pinned: [],
        machining: [],
        underlays: {},
        removedDucts: {},
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null, selectedRail: null,
        face: 'plate' as FaceId,
        screen: 'projects' as Screen,
        sizeLocked: false,
      };
    }),

  repeatProject: (id) =>
    set((s) => {
      const p = s.projects.find((q) => q.id === id);
      if (!p) return s;
      // 複製は「新しい作業」の始まり。いまの机は先にしまう
      const stashed = stashDraft(s);
      /*
       * 当時の部品がマスタから消えている（型式の入れ替え・整理）と、複製した図から
       * その機器だけ消えてしまう。完了時の写しから欠けているぶんだけ My部品へ戻す。
       * 現行マスタにある部品はいまの値で作る（新しく作る図なので）。
       */
      const have = new Set([...s.devices, ...s.myDevices].map((d) => d.id));
      const restored = (p.devices ?? []).filter((d) => !have.has(d.id));
      return {
        ...stashed,
        myDevices: restored.length > 0 ? [...s.myDevices, ...restored] : s.myDevices,
        currentDraftId: null,
        panel: structuredClone(p.panel),
        profile: structuredClone(p.profile),
        items: structuredClone(p.items),
        pinned: structuredClone(p.pinned),
        machining: structuredClone(p.machining),
        removedDucts: structuredClone(p.removedDucts),
        underlays: structuredClone(p.underlays),
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null, selectedRail: null,
        screen: 'faces' as Screen,
        // 複製元は完了した設計なので、寸法は確定済みとして始める
        sizeLocked: true,
      };
    }),

  updateProject: (id, patch) =>
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
      saveProjects(projects);
      return { projects };
    }),

  removeProject: (id) =>
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      saveProjects(projects);
      return { projects };
    }),

  loadProjectFile: (f) =>
    set((s) => {
      // 同じ案件を二重に持たないよう、id が重なるものは読み込んだほうで置き換える
      const ids = new Set(f.projects.map((p) => p.id));
      const projects = [...f.projects, ...s.projects.filter((p) => !ids.has(p.id))];
      saveProjects(projects);
      // 作業中の案件も同じ扱いで取り込む（古いファイルには入っていないので既存を残す）
      const incoming = f.drafts ?? [];
      if (incoming.length === 0) return { projects };
      const dids = new Set(incoming.map((d) => d.id));
      const drafts = [...incoming, ...s.drafts.filter((d) => !dids.has(d.id))];
      saveDrafts(drafts);
      return { projects, drafts };
    }),

});
