# GitHub アクション → Notion「対応Status」自動同期 — 説明ドキュメント

> [!NOTE]
> GitHub 側のアクションに応じて、Notion の **Product Requests DB**
> （`3cdb35e6e67f82de8ce181dc217f10f8`）の該当行の **`対応Status`** を自動更新します。
> 突合キーは `GitHub Issue URL` です。
> - Issue **Close** → `Fixed`（+ `GitHub Status = Closed`）
> - Open な Issue にコメント **`Check`** → `Approved for Dev`
> - Open な Issue にコメント **`OK`** → `In Progress`

## 背景

このワークスペースには、顧客サポートリクエストを **Salesforce → Notion → GitHub** の順に
流す連携が設計されています（`docs/notion-github-agent-design.md`）。中心にあるのが
Product Requests DB で、1 行が 1 件のリクエストを表します。GitHub と Notion の行は、
Notion 側の **`GitHub Issue URL`** プロパティで 1:1 に対応づけられます（これが唯一の突合キー）。

関係するプロパティは 3 つです。

- **`GitHub Issue URL`**（URL型）— 起票時に埋まる突合キー。
- **`GitHub Status`**（Select: Open / In Progress / PR Open / Merged / Closed）— GitHub 側の生の状態のミラー。
- **`対応Status`**（Status型: Intake → … → In Review → **Fixed** → Ready to Publish → Published → Closed）— 社内のワークフロー状態。

GitHub の「Issue を Close する」操作は、GitHub 側で `issues` イベント（`action = closed`）として
発火します。ここに反応して Notion を書き換えるのが今回の実装です。設計書の同期表にはもともと
*Issue Closed → 対応Status = Fixed* という行があり、今回はその 1 行を、**エージェントの判断に
依存しない決定的な仕組み**として実装しました。

## 意図

開発者が GitHub で Issue を閉じたあと、担当者が Notion を手で `Fixed` に直すのは、
忘れやすく・ズレやすい作業です。これを自動化します。

具体例で考えます。`対応Status = In Review` の行に対応する Issue #42 が Close されたとします。
すると自動で次のように変わります。

- 行の `対応Status`: **In Review → Fixed**
- `GitHub Status`: **→ Closed**
- `Last Synced At`: **実行時刻**

ただし `Fixed` は *ゴールではなく中間地点* です。顧客へ返信・公開してよいかは人が承認します。
そのため、**すでに `Fixed` 以降（Ready to Publish / Published / Closed）まで人が進めている行は、
Close イベントが再送されても後退させません**。

### コメント駆動の遷移（追加）

さらに、**Open な Issue へのコメント**で早い段階の状態を動かせるようにしました。開発者が
GitHub のコメントで合図するだけで、Notion 側のトリアージ状態が進みます。

| GitHub コメント | `対応Status` |
| --- | --- |
| `Check` | Approved for Dev |
| `OK` | In Progress |

マッチングはコメント本文を trim・大文字小文字無視で `check` / `ok` に**完全一致**した場合のみ。
Issue が Open でない場合や PR コメントは無視します。`Check` / `OK` は人が明示的に打つコマンドなので、
後退防止ガードは設けていません（「Open な Issue のみ」という条件が実質的なガードになります）。

## コード

変更ファイルです（ワークフロー YAML は権限の都合で設計書内に全文掲載）。

- `scripts/notion-sync-on-close.mjs` / `.test.mjs` — Issue クローズ同期ロジック＋単体テスト。
- `scripts/notion-sync-on-comment.mjs` / `.test.mjs` — コメント駆動（Check/OK）ロジック＋単体テスト。
- `.github/workflows/notion-sync-on-close.yml` — クローズ起動役（設計書 §13）。
- `.github/workflows/notion-sync-on-comment.yml` — コメント起動役（設計書 §14）。

**起動条件**は GitHub の Issue クローズだけです。

```yaml
on:
  issues:
    types: [closed]
```

スクリプトはまず突合キーで行を検索します。

```js
filter: { property: "GitHub Issue URL", url: { equals: issueUrl } }
```

次に**後退防止ガード**を通したうえで、該当行を更新します。

```js
const AT_OR_PAST_FIXED = new Set(["Fixed", "Ready to Publish", "Published", "Closed"]);
// current が上記に含まれるならスキップ（Publish 済みを Fixed に巻き戻さない）
properties: {
  "対応Status":    { status: { name: "Fixed" } },
  "GitHub Status": { select: { name: "Closed" } },
  "Last Synced At": { date: { start: new Date().toISOString() } },
}
```

該当行が無ければ何もしません（Notion 由来でない Issue のクローズは無視）。

> [!IMPORTANT]
> **権限メモ**: 今回コミットに使えたトークンには GitHub の `workflow` スコープが無く、
> `.github/workflows/` 配下のファイルをコミットできませんでした。ワークフロー YAML は
> 設計書 §13 に全文を掲載しています。GitHub の「Add file」など `workflow` スコープを持つ
> 経路で追加してください。

## 認証（検証）

`node --test` で 13 ケースが green です（クローズ 6 + コメント 7）。

- 進行中の行（In Review）→ `Fixed` に更新し、`GitHub Status = Closed` と `Last Synced At` も書き込む。
- `Published` の行 → **更新しない**（後退防止ガード）。
- 突合行なし → 何も PATCH しない。
- クエリが `GitHub Issue URL` 完全一致でフィルタされている。
- Notion が失敗を返したら明示的にエラーを投げる。
- `NOTION_TOKEN` / `ISSUE_URL` 未設定を弾く。
- コメント `Check` → `Approved for Dev`、`OK` → `In Progress`（trim・大小無視）。
- 認識できないコメントは Notion を叩かない／Open でない Issue は何もしない。

```
node --test scripts/notion-sync-on-close.test.mjs scripts/notion-sync-on-comment.test.mjs
# tests 13 / pass 13 / fail 0
```

**手動 QA 手順**

1. 設計書 §13 の YAML を `.github/workflows/notion-sync-on-close.yml` として追加。
2. リポジトリ Secrets に `NOTION_TOKEN`（対象 DB に**書き込み権限**のある Notion インテグレーションのトークン）を登録。
3. その Notion インテグレーションを Product Requests DB に接続（Connections）。
4. `GitHub Issue URL` が埋まっているテスト行を用意し、その Issue を Close。
5. Actions のログと DB 行を確認（`対応Status = Fixed` / `GitHub Status = Closed` / `Last Synced At` 更新）。

## 代替案

### 代替案 A: Notion カスタムエージェントの GitHub トリガー

| 長所 | 短所 |
| --- | --- |
| 製品ネイティブ。設計書のエージェント構想と一致 | LLM 判断のため決定性・監査性が GitHub Actions に劣る |
| ラベルやコメント要約など柔軟な処理が可能 | トリガー/接続の設定はエージェント設定 UI が必要（ハーネスからは変更不可） |

### 代替案 B: Notion ネイティブのデータベース自動化

| 長所 | 短所 |
| --- | --- |
| コード不要・Notion 内で完結 | GitHub の Close を直接受け取れない（Notion 内の変化しか起点にできない） |
| | 結局 `GitHub Status` を別経路で更新する必要があり、今回の要件単独では成立しにくい |

採用した **GitHub Actions 方式**は、GitHub の Close を直接の起点にでき、テスト可能で決定的、
という点で今回の要件に最も素直です。

## 相談相手の推奨

- **Aoi Koike**（akoike@makenotion.com）— 変更対象周辺（`docs/notion-github-agent-design.md`、
  `.github/ISSUE_TEMPLATE`、`labels.md`）の**全コミットの作者**であり、Salesforce→Notion→GitHub 連携と
  Product Requests DB のプロパティ設計の背景を最もよく把握しています。突合キーやステータス遷移の意図を
  確認する相手として最適です。

## テスト（理解度チェック）

<details>
<summary>Q1. 同期の突合キー（GitHub の Issue と Notion 行を対応づける鍵）は何？</summary>

- A. `GitHub Status`
- B. `対応Status`
- **C. `GitHub Issue URL`** ✅
- D. Notion のページタイトル `Request`

**解説**: URL の完全一致でフィルタして行を特定します（`filter.url.equals`）。Status 系はキーではなく更新対象。タイトルは一意でないため不適。
</details>

<details>
<summary>Q2. `対応Status` がすでに `Published` の行に対して Issue Close が届いたら？</summary>

- A. `Fixed` に更新する
- **B. 何もしない（後退防止ガードでスキップ）** ✅
- C. `Closed` に更新する
- D. エラーで停止する

**解説**: `AT_OR_PAST_FIXED`（Fixed / Ready to Publish / Published / Closed）に該当する行はスキップ。人が Publish まで進めた行を巻き戻さないためで、「Fixed から先は人の承認」という設計原則と整合します。
</details>

<details>
<summary>Q3. なぜ GitHub Actions 方式を採用した？（代替のエージェントトリガーに対して）</summary>

- A. 実装が唯一可能だから
- **B. GitHub の Close を直接の起点にでき、決定的でテスト可能だから** ✅
- C. Notion API を使わずに済むから
- D. LLM の判断で柔軟に処理できるから

**解説**: D はエージェント方式の利点。本方式は逆に決定性・監査性が強みです。C は誤り（本方式こそ Notion API を直接呼びます）。
</details>

<details>
<summary>Q4. `GitHub Issue URL` に一致する行が 1 つも無いときの挙動は？</summary>

- A. 新しい行を作成する
- B. エラーで失敗する
- **C. 何も更新せず正常終了する** ✅
- D. 全行を Fixed にする

**解説**: Notion 由来でない Issue のクローズを安全に無視するため、no-op で終了します（テストで担保）。
</details>

<details>
<summary>Q5. このワークフローを有効化するために、リポジトリ側で必要な設定は？</summary>

- A. 何も要らない、マージすれば動く
- **B. `NOTION_TOKEN` Secret の登録と、その Notion インテグレーションへの DB 接続** ✅
- C. Notion 側で対応Status を手で Fixed にしておく
- D. `GitHub Issue URL` プロパティを削除する

**解説**: 加えて（今回の権限制約により）ワークフロー YAML 自体を `workflow` スコープを持つ経路で追加する必要があります。A は誤り（Secret とファイル追加が前提）。
</details>

<details>
<summary>Q6. Open な Issue に <code>looks ok to me</code> というコメントが付いたら？</summary>

- A. `In Progress` に変更される
- B. `Approved for Dev` に変更される
- **C. 何も起きない（コマンド完全一致ではない）** ✅
- D. エラーになる

**解説**: マッチングは trim・大小無視の**完全一致**で `check` / `ok` のみ。`looks ok to me` は一致しないため no-op（Notion のクエリすら発行しません）。誤爆を避けるための仕様です。
</details>
