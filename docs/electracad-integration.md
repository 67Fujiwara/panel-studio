# ElectraCAD Studio への差し込み

Panel Studio で設計完了すると、ZIP の中に **`<案件番号>_electracad.json`** が 1 つ入ります。
これは **図枠を持たない「中身だけ」** の図面データで、ElectraCAD Studio 側で
**ElectraCAD の図枠に入れて、仕様ページの次に差し込む**ためのものです。
縮尺は ElectraCAD 側が自分の図枠の作図領域に合わせて決めます（このファイルは各シートの実寸を持っています）。

DXF / PDF は Panel Studio 単体で完結した図（板金屋・加工屋・現場向け）で、こちらはそのまま残ります。

## ファイルの中身

UTF-8 の JSON 1 つです。トップレベルは次のとおり。

| キー | 中身 |
| --- | --- |
| `format` | `"panel-studio/electracad-sheets"`。これ以外なら読まない |
| `version` | `1` |
| `generator` / `exportedAt` | `"Panel Studio"` と書き出し日時（ISO 8601） |
| `units` | `"mm"` |
| `coordinates` | 座標系の説明文（左下原点・Y 上向き・角度は度で反時計回り） |
| `standardScales` | 縮尺の候補 `[1, 2, 2.5, 5, 10, 20, 50]`（1:n の n） |
| `job` | `company` `jobNo` `owner` `completedAt`(YYYY-MM-DD) `note` — 設計完了のときに入れた案件情報。図枠の表題欄に使う |
| `panel` | `model`, `outer {w,h,d}`, `plate {w,h}` — 盤の型式と寸法 |
| `sheets[]` | 4 枚のシート（下記） |

`sheets` は必ずこの順で 4 枚です。

| `id` | `title` | 中身 |
| --- | --- | --- |
| `cabinet_full` | キャビネット（機器つき） | 6 面を三面図の並びで。機器・ダクト・レール・加工・面の名前 |
| `cabinet_holes` | キャビネット（加工穴のみ） | 同じ並びで加工だけ（文字なし） |
| `plate_full` | 中板（機器つき） | ダクト・DIN レール・機器・型式・加工 |
| `plate_holes` | 中板（加工穴のみ） | 加工だけ |

シート 1 枚は次の形です。

```jsonc
{
  "id": "plate_full",
  "title": "中板（機器つき）",
  "extent": { "w": 540, "h": 740 },            // 図の実寸 mm。左下 (0,0) 〜 右上 (w,h)
  "layers": { "外形": { "color": "#000000", "aci": 7 }, "機器": { "color": "#295cb3", "aci": 5 }, ... },
  "entities": [
    { "t": "line",   "layer": "外形", "x1": 0, "y1": 0, "x2": 540, "y2": 0 },
    { "t": "circle", "layer": "加工-丸穴", "cx": 30, "cy": 700, "r": 2.25 },
    { "t": "arc",    "layer": "加工-切り欠き", "cx": 100, "cy": 100, "r": 5, "a0": 0, "a1": 90 },   // 度・反時計回り a0→a1
    { "t": "text",   "layer": "機器-型式", "x": 12, "y": 402, "h": 8, "s": "S-T12", "rot": 0 }      // (x,y) は左下、h は文字高 mm
  ],
  "svg": "<svg xmlns=... viewBox=\"0 0 540 740\" width=\"540mm\" height=\"740mm\">...</svg>"
}
```

- 座標は **mm・左下原点・Y 上向き**（DXF と同じ）。画面座標（Y 下向き）で描くときは `y' = extent.h - y`
- `svg` は **1 mm = 1 ユーザー単位**で、上下の反転は済んでいます（そのまま貼れば正しい向き）。
  `viewBox` はそのまま、`width` / `height` を **`extent / n` mm** に付け替えれば 1:n になります。
  線幅は `vector-effect: non-scaling-stroke` で縮尺にかかわらず 1px。印刷用に太くするなら `stroke-width` を差し替えてください
- レイヤ名は 外形／機器／機器-型式／ダクト／DINレール／加工-丸穴／加工-タップ／加工-切り欠き／図面-注記。
  `layers` には**そのシートで使っているものだけ**が入ります。`color` は画面・PDF と同じ色、`aci` は AutoCAD の色番号
- 文字は UTF-8（DXF の Shift-JIS とは違います）

## 縮尺の決め方

図枠の作図領域（表題欄・余白を除いた、図を置ける四角）を `area {w,h}` mm とすると、

```
n = standardScales のうち extent.w / n <= area.w かつ extent.h / n <= area.h を満たす最小の n
（どれも収まらなければ n = ceil(max(extent.w/area.w, extent.h/area.h) * 10) / 10）
```

これが「収まるいちばん大きい標準縮尺」です。表題欄には `1:n` を書き、図は作図領域の中央に置きます。
中板は縦長・キャビネットは 6 面を並べているので横長です。A3 横の図枠なら中板 700×900 が 1:5、
キャビネット 1720×2084 が 1:10 あたりになります。

## ElectraCAD Studio 側で必要な準備（プロンプト）

ElectraCAD Studio を作っている AI にそのまま渡せる文章です。

---

```
Panel Studio（制御盤の機器配置ソフト）が書き出す JSON を読み込み、ElectraCAD Studio の図枠に入れて
「仕様ページの次」に図面ページとして差し込む機能を追加してください。

## 入力ファイル
- ファイル名は `<案件番号>_electracad.json`（UTF-8 の JSON）。設計完了時の ZIP に DXF・PDF と一緒に入っている。
  ZIP のまま渡されることもあるので、ZIP を選んだら中の `*_electracad.json` を探して読む（無ければエラー表示）。
- `format` が "panel-studio/electracad-sheets" で `version` が 1 のときだけ受け付ける。違えばエラーにする。
- トップレベル: format, version, generator, exportedAt, units("mm"), coordinates(説明文), standardScales,
  job {company, jobNo, owner, completedAt, note}, panel {model, outer{w,h,d}, plate{w,h}}, sheets[4]
- sheets は必ずこの順の 4 枚: cabinet_full / cabinet_holes / plate_full / plate_holes。
  各シート: id, title(日本語), extent{w,h}(実寸 mm), layers{名前: {color, aci}}, entities[], svg(文字列)
- entities の型:
  - line:   {t:"line",   layer, x1,y1,x2,y2}
  - circle: {t:"circle", layer, cx,cy,r}
  - arc:    {t:"arc",    layer, cx,cy,r, a0,a1}   角度は度、反時計回りに a0→a1
  - text:   {t:"text",   layer, x,y, h, s, rot}   (x,y)は文字の左下、hは文字高 mm、rotは度(反時計回り)
- 座標系: mm、左下が原点、X 右向き、Y 上向き。画面（Y 下向き）に描くなら y' = extent.h - y。

## やること
1. 読み込み UI: 「Panel Studio の図面を差し込む」ボタン（またはドラッグ＆ドロップ）。JSON か ZIP を受ける。
2. 4 シートそれぞれを 1 ページにする。ページの図枠・表題欄は ElectraCAD Studio の既存のものを使う
   （Panel Studio 側は図枠を持っていない）。
3. ページの差し込み位置は「仕様ページの直後」。既存のページ順序を崩さず、ページ番号を振り直す。
   同じ案件の JSON をもう一度読んだら、前に差し込んだ 4 ページを置き換える（重複させない）。
   識別は job.jobNo と sheet.id の組で行う。
4. 表題欄には job.company（納入先）、job.jobNo（案件番号）、job.owner（担当）、job.completedAt（日付）、
   panel.model（盤の型式）、panel.outer（W×H×D）、sheet.title（図の名前）、縮尺 1:n を入れる。
   job.note が空でなければ備考欄に入れる。
5. 縮尺: 図枠の作図領域（表題欄・余白を除いた四角）の幅 area.w・高さ area.h(mm) に対して、
   standardScales [1,2,2.5,5,10,20,50] のうち extent.w/n <= area.w かつ extent.h/n <= area.h を
   満たす最小の n を選ぶ。どれも収まらないときは n = ceil(max(extent.w/area.w, extent.h/area.h)*10)/10。
   図は作図領域の中央に置く（縮小しても上下左右の余りは均等に）。縮尺は自動でよいが、ユーザーが
   縮尺を選び直せるプルダウンも置く。
6. 描画: 手っ取り早いのは sheet.svg をそのまま図枠の中に置く方法。svg は 1 mm = 1 ユーザー単位で
   上下反転済みなので、viewBox はそのまま、width/height を extent.w/n mm・extent.h/n mm にするだけで
   縮尺になる。線幅は vector-effect: non-scaling-stroke で 1px になっているので、印刷で太くしたい
   ときは stroke-width を上書きする。
   ElectraCAD のキャンバスが SVG でない（Canvas・PDF ライブラリなど）なら、entities を上の座標系で
   自前で描く。円弧は a0→a1 を反時計回りで。文字は左下基準・高さ h mm で、フォントは英数字を
   Helvetica/Arial 系、日本語を Noto Sans JP / 游ゴシック / メイリオのいずれかにする。
7. 色: layers[名前].color（#rrggbb）を線の色に使う。印刷が白黒のときは全部黒にする設定を用意する。
   レイヤ「機器-型式」「図面-注記」は文字だけのレイヤ。加工穴だけのシート（*_holes）には文字は入っていない。
8. 出力: 差し込んだページは ElectraCAD Studio の通常の出力（PDF・印刷）にそのまま含める。
   別ファイルにはしない。
9. 検証: 実寸 540×740 の中板（plate_full）を A3 横の図枠に入れて 1:5 になること、
   entities の座標が 0〜extent の範囲に収まっていること、text の "S-T12" のような型式が読めること、
   JSON を 2 回読んでもページが 4 枚のままであることをテストする。

## してはいけないこと
- Panel Studio の JSON を書き換えて保存しない（読み取り専用の入力として扱う）。
- 図枠や表題欄を Panel Studio 側に求めない。図枠は ElectraCAD Studio のもの。
- format/version が違うファイルを「たぶん読める」と黙って読まない。エラーにする。
```

---

## Panel Studio 側の実装

- `src/lib/electraExport.ts` — `ElectraSheetWriter`（DXF・PDF と同じ `Drawer` を受けて entities と SVG を作る）、
  `buildElectraFile`、`fitScale`（上の縮尺の式の参考実装）
- `src/lib/dxfExport.ts` — `cabinetElectra` / `plateElectra` / `electraJson`。`buildDxfSet(input, base, job)` が
  9 ファイル目として `<案件番号>_electracad.json` を足す
- 設計完了（面選択画面）と完了案件の行の「DXF」の両方から出ます。完了案件からは、完了時に入れた案件情報が入ります
