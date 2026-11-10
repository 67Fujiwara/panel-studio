# Panel Studio の開発ルール

制御盤の盤内レイアウトと BOM を作るアプリ。ブラウザだけで動く HTML 1 ファイルを共有フォルダに置いて使う。
言語・構成は TypeScript + React + Vite のまま育てる（作り直さない）。

## 変更のたびに必ずやること

1. **先にテストを書く。** 機能を足すとき・バグを直すときは、
   - その機能だけの**単体テスト**（`tests/unit/*.test.ts`、Vitest）
   - **他の機器と組み合わせた**テスト（遮断器・接触器・PLC・電源・端子台・止め金具・座標置き・ダクトの余白など、
     実案件に近い組み合わせで `autoLayout` を通す。`tests/unit/layout.golden.test.ts` にシナリオを足すか、
     `tests/unit/layout.test.ts` に期待値を書く）
   - 画面の操作が絡むなら `tests/e2e/*.spec.ts`（Playwright、ビルド済み HTML を操作）
2. `npm test` と `npm run build:single` と `npm run test:e2e` を通す。
3. 配置の数値が変わる変更は、`layout.golden.test.ts` のスナップショットが落ちる。
   意図した変更なら `npx vitest run -u` で更新し、**なぜ変わったか**をコミットメッセージに書く。
4. README に「何を・なぜ」を書く。コミットは日本語で、1 行目に何をしたかを書く。

## 守ること

- メーカー配布の DXF/DWG はリポジトリにもアプリにも入れない（数値だけ持つ）。
- API キーは HTML・JSON・バックアップに埋めない（ブラウザの localStorage だけ）。
- 座標で指定した機器は、ダクトの位置や余白で動かさない（矢印キーで左右に寄せただけの onRail は段のレールに付いていく）。
- 新規プロジェクトではサイドバーの設定（ダクト・余白・レール手直し・冷却の入力）を初期化する。決めごと（レールの余長・固定穴・冷却の定数）は残す。

## 構成の要点

- `src/lib/layout/` 配置計算。`pack.ts` は「枠を作る → 置き場所を探す → 段とダクトを決める」の 3 手順。
  `push.ts` が段を上へ詰め、`rails.ts` が DINレール、`checks.ts` が検査。入口は `index.ts`（`autoLayout`）。
- `src/lib/layout/drag.ts` と `nudge.ts` がドラッグ・矢印キーの判定（純粋な関数）。画面は答えを書くだけ。
  微調整を直すときは `tests/unit/interact.combo.test.ts`（手順どおり）と `interact.fuzz.test.ts`（でたらめな順番）に
  シナリオを足す。
- `src/store.ts` 状態と操作（zustand）。`src/components/PanelCanvas.tsx` 図とドラッグ・キー操作。
- 分割の進め方は `docs/refactoring-plan.md`。

## ビルドと配布

- `npm run build:single` → `release/panel-studio.html`（バージョン表示はコミット数 + 1）。
- 開発ブランチ `claude/control-panel-bom-automation-6yfogx` に push し、`main` を fast-forward する
  （先に `git fetch origin main` して祖先関係を確かめる）。
