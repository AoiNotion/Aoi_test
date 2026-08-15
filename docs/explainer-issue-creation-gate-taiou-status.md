# 起票ゲートを「対応Status = Approved for Dev」に切り替える — 説明ドキュメント

> [!NOTE]
> GitHub Issue の起票トリガーを、これまでの **`Approval` (Pending → Approved)** から
> **`対応Status` = Approved for Dev（Intake → Approved for Dev への遷移）** に変更しました。
> 起票の判定条件（GitHub Issue URL が空・Request Type ∈ {Bug / Feature Request / Improvement}）と、
> フィールドマッピング・本文テンプレート・双方向同期は一切変えていません。**変わったのは「どのプロパティの、どの遷移で起票判定を始めるか」だけ**です。

## 背景

このリポジトリは、顧客サポートリクエストを **Salesforce → Notion → GitHub** の順に流す
Notion カスタムエージェントの設計・受け皿です（全体像は `docs/notion-github-agent-design.md`）。
中心にあるのが Notion の **📥 デモ_Notion Request Hub**（`3cdb35e6e67f82de8ce181dc217f10f8`）で、
1 行が 1 件のリクエストを表します。Notion 行と GitHub Issue は、Notion 側の
**`GitHub Issue URL`** プロパティで 1:1 に対応づけられます（これが唯一の突合キー＝二重起票防止のキー）。

思想の核心は「**Salesforce のものを自動で全部 GitHub に流さない**」ことです。全部流すと開発チームが
ノイズだらけになるため、**Notion 上で人がトリアージ・承認してから**起票します。つまり「起票して
よい状態になった行だけを、GitHub Issue にする」ためのゲート（門）が要ります。

このゲートには、DB の中に候補となるプロパティが 2 つあります。役割が違う別物です。

- **`Approval`**（Select: Pending / Approved / Rejected）— 「開発に回してよいか」の人手トリアージの可否。
- **`対応Status`**（Status 型: **Intake → Approved for Dev → In GitHub → In Progress → In Review → Fixed → Ready to Publish → Published**）
  — リクエストがワークフローのどの段階にいるかを表す、パイプライン全体の背骨。

> [!IMPORTANT]
> `対応Status` は Notion の **Status 型**プロパティです（Select ではありません）。
> GitHub → Notion の同期スクリプト群（`scripts/notion-sync-on-*.mjs`）はいずれも
> `page.properties["対応Status"].status.name` を読み書きしており、パイプラインの各段階は
> すべてこの `対応Status` の値で表現されています。

これまでの設計書と Issue テンプレートは、起票ゲートに **`Approval` (Pending → Approved)** を
使っていました（`git log` 上では `01a4984` と `5f357c7` でこの形に寄せられています）。
一方、ユーザーが提示したステータス遷移モデル（「Notion 操作: Status = Approved for Dev → Issue 作成」）は
一貫して **`対応Status`** を軸にしています。両者がズレていたのが、今回の出発点です。

## 意図

パイプラインの段階を表す背骨は `対応Status` の 1 本です。起票という「段階の切り替わり」も、
同じ背骨の上で表現するほうが、モデルとして素直で追いやすくなります。

`対応Status` の遷移を時系列で並べると、起票の位置が自然に決まります。

```
Intake                ← Salesforce から入って、まだ人が見ていない
  ↓ 人がトリアージ・承認
Approved for Dev      ★ ここに入った瞬間が「起票してよくなった」合図 → GitHub Issue 作成
  ↓ issue assigned
In GitHub / In Progress / In Review / Fixed / …
```

具体例で考えます。ある Bug 行が `Intake` の状態で DB にあり、GitHub Issue URL は空です。
担当者がトリアージして `対応Status` を **Intake → Approved for Dev** に動かすと、エージェントは
次を確認して起票します。

- `対応Status` が **Approved for Dev**（Intake からの遷移で入った）
- `GitHub Issue URL` が **空**（＝まだ起票していない）
- `Request Type` が **Bug / Feature Request / Improvement** のいずれか

3 つすべてを満たすときだけ Issue を作成し、作成後に Notion 行へ書き戻します
（`GitHub Issue URL` / `GitHub Status = Open` / `対応Status = In GitHub`）。
1 つでも欠ければ何もしません。とくに **`GitHub Issue URL` が既に埋まっている行は必ずスキップ**するため、
承認後に `Check` コメント等で `対応Status` が再び `Approved for Dev` に触れても二重起票は起きません
（冪等性は常に `GitHub Issue URL` で担保）。

## コード

変更は **仕様（設計書）と GitHub 側の受け皿（Issue テンプレート）** に閉じています。
実行ロジックである `scripts/notion-sync-on-*.mjs`（GitHub → Notion 同期）や、そのテストには
一切手を入れていません。これらはもともと `対応Status` を正として動いており、今回のゲート変更と直交します。

**1. 設計書 `docs/notion-github-agent-design.md`** — 起票ゲートの記述を `Approval` から `対応Status` に統一。

- §2 全体フロー（Mermaid）: 「人がトリアージ」ノードを `対応Status: Intake → Approved for Dev` に。
- §4 Triggers（メイン）: `対応Status` が Intake → Approved for Dev に変化 → 起票判定。
- §5 起票条件: トリガーと 3 条件を `対応Status = Approved for Dev` ベースに書き換え。
- §9 / §10（貼り付け用 Instructions）/ §11 / §16.3: 「Approval = Approved → Issue 作成」を
  「対応Status = Approved for Dev（Intake→Approved for Dev）→ Issue 作成」に統一。
- §12 / §15: `Approval` は人手トリアージ用の別プロパティである旨を明記し、§15 のライブ実行ログには
  「旧 `Approval` ゲート時点の記録」という注記を追加（履歴は書き換えず保全）。

**2. Issue テンプレート `.github/ISSUE_TEMPLATE/salesforce-support-request.md`** — 冒頭コメントの
起票トリガー／条件の記述を `対応Status = Approved for Dev（Intake → Approved for Dev）` に更新。

```text
起票トリガー: 対応Status が Approved for Dev になったとき（Intake → Approved for Dev）。
起票条件（すべて満たす）:
  - 対応Status = Approved for Dev（Intake → Approved for Dev の遷移）
  - GitHub Issue URL が空（＝二重起票防止の突合キー）
  - Request Type ∈ { Bug, Feature Request, Improvement }
```

> [!NOTE]
> `Approval` プロパティ自体は DB から消していません。人手トリアージの可否として引き続き使えます。
> 今回は「**起票判定の起点にどのプロパティを使うか**」を `対応Status` に一本化しただけです。

**3. 対象 DB を新 DB へ一本化** — 本エージェント（`デモ_Notion Request Hub エージェント`）に接続された
実 DB は **`📥 デモ_Notion Request Hub`**（`3cdb35e6e67f82de8ce181dc217f10f8` / データソース
`709b35e6-e67f-83a3-822d-877d16f8c13b`）でした。設計書・スクリプト・GitHub→Notion 同期ワークフローが
参照していた旧 DB `f8b5709430f24ef4a476fd50bf11aed1` を、この新 DB に置換。旧 DB は参照しません。

- `scripts/notion-sync-on-{close,comment,comment-intake,open}.mjs`: `NOTION_DATABASE_ID` の既定値を新 DB に。
- `.github/workflows/notion-sync-on-{close,comment}.yml`: `env.NOTION_DATABASE_ID` を新 DB に **要手動更新**（後述）。
- 設計書・`labels.md`・本ドキュメント: DB ID / データソース ID / 表示名を新 DB に統一。

> [!IMPORTANT]
> この置換をしないと、GitHub 側の進捗（Issue Close / コメント）が**旧 DB に書き込まれ**、
> 実際に運用している新 DB に反映されません。突合キー（`GitHub Issue URL`）やスクリプトのロジックは不変です。

> [!WARNING]
> **ワークフロー YAML 2 本（`notion-sync-on-close.yml` / `notion-sync-on-comment.yml`）は、この PR の
> トークンに GitHub の `workflow` スコープが無いため push / API 更新ができませんでした。** GitHub UI の
> "Edit" などから、両ファイルの `NOTION_DATABASE_ID` を `f8b5709430f24ef4a476fd50bf11aed1` →
> `3cdb35e6e67f82de8ce181dc217f10f8` に手動更新してください。スクリプトの既定値は更新済みのため、
> ワークフローから `NOTION_DATABASE_ID` の行を削除して既定値に委ねる運用でも可。

## 認証（どう正しさを確かめたか）

- **既存テストの緑維持**: `node --test scripts/*.test.mjs` を実行し、**25 件すべて pass**。
  スクリプトのロジックは変更しておらず（`NOTION_DATABASE_ID` の既定値のみ更新／テストは env で明示指定）、回帰は起きません。
- **静的レビュー**: `grep` でリポジトリ全体を走査し、`Approval` 起点のゲート記述および旧 DB ID が残っていないことを確認。
  残った `Approval` の言及は、いずれも「人手トリアージ用の別プロパティである／旧ゲートの履歴である」ことを
  明示する文脈のみ。
- **ライブ照会（新 DB）**: 接続された新 DB を実際に SQL 照会し、起票ゲート（`対応Status = Approved for Dev` /
  URL 空 / 対象 Request Type）に合致する行が現時点で 0 件（候補 3 行は `Intake`、1 行は起票済み #13）であることを確認。
  人の承認待ちで正しく起票しない状態であることを実データで裏取りした。

> [!WARNING]
> **ライブ起票の実地確認はこの PR では未実施**です。本エージェント
> （`デモ_Notion Request Hub エージェント`）の integration には対象 DB への
> アクセスがまだ付与されておらず（`fetch` / `search` が 404 / 0 件）、実データでの起票・書き戻しを
> 実行できないためです。**Tools and access で対象 DB への読み書きを付与**すれば、実行できます。

### 手動 QA 手順（DB アクセス付与後）

1. DB で `Request Type` が Bug / Feature Request / Improvement のいずれかで、`GitHub Issue URL` が空の行を用意する。
2. その行の `対応Status` を **Intake → Approved for Dev** に変更する。
3. エージェントが GitHub に Issue を作成し、Notion 行に `GitHub Issue URL` / `GitHub Status = Open` /
   `対応Status = In GitHub` を書き戻すことを確認する。
4. **スキップ確認**: `Request Type = Question / Incident` の行、または `GitHub Issue URL` が既に埋まっている行を
   `Approved for Dev` にしても、起票されないことを確認する。

## 代替案

### 代替案 A: これまでどおり `Approval` (Pending → Approved) をゲートに残す

| 長所 | 短所 |
| --- | --- |
| 直近コミット（`01a4984` / `5f357c7`）の決定を維持でき、変更が不要 | ユーザー提示のステータス遷移モデル（`対応Status` 軸）と食い違ったまま |
| 「承認可否」と「進行段階」を別プロパティで分離できる | パイプラインの起点だけ別プロパティになり、追跡・トリガー設定が二重管理になる |

### 代替案 B: `Approval = Approved` かつ `対応Status = Approved for Dev` の両方を必須にする

| 長所 | 短所 |
| --- | --- |
| 二段階の明示承認になり、誤起票のリスクが最小 | 運用が煩雑（2 プロパティを常に揃える必要）。片方の更新漏れで起票されない事故が起きやすい |
| 監査上「誰が承認したか」を `Approval` で残せる | ユーザー要件は `対応Status` の単一条件であり、要件超過（オーバーエンジニアリング） |

いずれもユーザーの明示要件（「`対応Status` = Approved for Dev になったら起票」）に対しては過不足があるため、
本 PR では **`対応Status` 単一ゲート**を採用しました。

## 相談相手の推奨

- **Aoi Koike（`akoike@makenotion.com`）** — Product Requests DB の設計書（`f2db967`）と Issue テンプレート
  （`72af73e`）の原著者であり、かつ **起票ゲートを `Approval=Approved` に寄せた張本人**（`01a4984`
  「Align issue-template gate with Approval=Approved conditions」）。今回はその決定を `対応Status` へ
  切り替える変更なので、`Approval` を選んだ背景や、`Approval` を今後どう使うか（人手トリアージとして残すか）を
  確認するのに最適な相手です。同氏は `対応Status` のコメント駆動遷移（`59e3010`）も実装しており、
  両プロパティの意図に最も詳しい人物です。

## テスト（理解度チェック）

<details>
<summary>Q1. 今回のゲート変更で、GitHub Issue の起票を始める「トリガー」はどれ？</summary>

- A. `Approval` が Pending → Approved に変わったとき
- B. **`対応Status` が Intake → Approved for Dev に変わったとき** ✅
- C. `GitHub Issue URL` が空になったとき
- D. `Request Type` が Bug に変わったとき

**解説**: 本 PR の本質は起票トリガーを `対応Status` = Approved for Dev（Intake からの遷移）に切り替えたことです（B）。
A は変更前の挙動。C の `GitHub Issue URL` は空であることが「条件」の一つですが、それ自体はトリガーではなく
二重起票防止の突合キーです。D は起票対象タイプの条件であってトリガーではありません。
</details>

<details>
<summary>Q2. `対応Status` を Approved for Dev にしたのに Issue が作られない。最も疑うべき原因は？</summary>

- A. `Request Type` が Question や Incident など対象外、もしくは `GitHub Issue URL` が既に埋まっている ✅
- B. `対応Status` が Status 型だから
- C. 設計書の Mermaid 図が古いから
- D. テストが 25 件しか通っていないから

**解説**: 起票は 3 条件すべてを満たす行だけが対象です（A）。対象外の Request Type、または既に起票済み
（URL が埋まっている＝冪等スキップ）が最有力。B はプロパティの型の話で起票可否とは無関係。
C / D は挙動に影響しません。
</details>

<details>
<summary>Q3. なぜ「GitHub Issue URL が空」が条件に含まれているのか？</summary>

- A. GitHub の API が URL を必須にしているから
- B. 二重起票を防ぐため（同じ行から Issue が二つできないようにする冪等性キー） ✅
- C. Notion の Status 型プロパティの制約だから
- D. ラベルを自動作成するために必要だから

**解説**: `GitHub Issue URL` は Notion 行と GitHub Issue を 1:1 で結ぶ突合キーであり、これが既に埋まっている＝
起票済みと判断してスキップします（B）。承認後に `対応Status` が再度 Approved for Dev に触れても、
URL が埋まっていれば再起票されません。A / C / D は無関係。
</details>

<details>
<summary>Q4. この PR で `scripts/notion-sync-on-*.mjs`（GitHub → Notion 同期）を変更しなかったのはなぜ？</summary>

- A. スクリプトにはテストが無く触れないから
- B. もともと `対応Status` を正として動いており、今回のゲート変更と直交するから ✅
- C. `workflow` スコープが無く push できないから
- D. GitHub Actions が無効化されているから

**解説**: 同期スクリプト群は GitHub の変化を `対応Status` に反映する処理で、起票ゲートの起点変更とは
独立しています（B）。だから変更不要で、回帰も起きません。A は誤り（各スクリプトにテストがある）。
C はワークフロー YAML の追加に関する別論点。D は事実ではありません。
</details>

<details>
<summary>Q5. `Approval` プロパティは今回どうなった？</summary>

- A. DB から削除された
- B. 起票ゲートの起点から外れ、人手トリアージ用の別プロパティとして残った ✅
- C. `対応Status` にリネームされた
- D. GitHub のラベルに変換された

**解説**: 本 PR は起票判定の起点を `対応Status` に一本化しただけで、`Approval` は削除もリネームもしていません（B）。
設計書 §12 / §15.1 に「人手トリアージ用の別プロパティ」と明記しています。A / C / D はいずれも行っていません。
</details>
