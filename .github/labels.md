# ラベル体系（Notion ↔ GitHub 連携）

Notion「📥 デモ_Notion Request Hub」から Issue を起票する際、以下のラベルを付与します。ラベル名の正式値は実データで確定済み（2026-08-15）。

> [!NOTE]
> **GitHub 側**: `POST /repos/.../issues` に存在しないラベル名を渡すと、そのラベルはデフォルト色で**自動作成**される（本連携で `priority:critical` / `impact:critical` の自動作成を確認済み）。事前作成は必須ではないが、色や説明を整えたい場合は先に作成しておくとよい。
> **Notion 側**: `GitHub Labels`（multi_select）は存在しない選択肢を**自動作成しない**。Notion 行へ書き戻す前に、データソースのスキーマへ選択肢を追加すること（`update_data_source` の `ALTER COLUMN "GitHub Labels" SET MULTI_SELECT(...)`。既存選択肢も併記して消さないよう注意）。

## Request Type（Notion: Request Type）
| Notion 値 | GitHub ラベル |
| --- | --- |
| Bug | `type:bug` |
| Feature Request | `type:feature` |
| Improvement | `type:improvement` |

> 上記 3 種以外（例: Question / Other）は Issue を起票しません。

## Priority（Notion: Priority）
Notion の `Priority` は `P0` / `P1` / `P2` / `P3`（`Customer Impact` とは独立したプロパティ）。

| Notion 値 | GitHub ラベル |
| --- | --- |
| P0 | `priority:critical` |
| P1 | `priority:high` |
| P2 | `priority:medium` |
| P3 | `priority:low` |

## Product Area（Notion: Product Area）
`Product Area` は自由記述テキスト（例: `投資家検索 / アタックリスト`）。値が非定型のため **Area ラベルは付与しない**（既存 Issue #6 / #8 / #10 および 2026-08-15 起票の #12–#14 でも Area ラベルは未付与）。Product Area は Issue 本文の分類として記載する。

## Customer Impact（Notion: Customer Impact）
| Notion 値 | GitHub ラベル |
| --- | --- |
| Low | `impact:low` |
| Medium | `impact:medium` |
| High | `impact:high` |
| Critical | `impact:critical` |

## トリアージ用ラベル（Notion → GitHub 操作で使用）
| 契機 | GitHub ラベル |
| --- | --- |
| Notion Status = Needs Info | `needs-info` / `blocked` |
| Notion で Duplicate 指定 | `duplicate` |
