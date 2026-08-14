# ラベル体系（Notion ↔ GitHub 連携）

Notion のサポートリクエスト DB から Issue を起票する際、以下のラベルを付与します。
GitHub API は存在しないラベルを付与するとエラーになるため、**Issue 起票の前にリポジトリ側でこれらのラベルを作成しておく必要があります**。

ラベル名の正確な値（`priority:*` など）は、Notion DB のプロパティ選択肢に合わせて確定してください（DB アクセス付与後に最終調整）。

## Request Type（Notion: Request Type）
| Notion 値 | GitHub ラベル |
| --- | --- |
| Bug | `type:bug` |
| Feature Request | `type:feature` |
| Improvement | `type:improvement` |

> 上記 3 種以外（例: Question / Other）は Issue を起票しません。

## Priority（Notion: Priority）
| Notion 値 | GitHub ラベル |
| --- | --- |
| P0 / Critical | `priority:critical` |
| P1 / High | `priority:high` |
| P2 / Medium | `priority:medium` |
| P3 / Low | `priority:low` |

## Product Area（Notion: Product Area）
| 例 | GitHub ラベル |
| --- | --- |
| （DB の選択肢に合わせる） | `area:<name>` |

## Customer Impact（Notion: Customer Impact）
| 例 | GitHub ラベル |
| --- | --- |
| （DB の選択肢に合わせる） | `impact:<level>` |

## トリアージ用ラベル（Notion → GitHub 操作で使用）
| 契機 | GitHub ラベル |
| --- | --- |
| Notion Status = Needs Info | `needs-info` / `blocked` |
| Notion で Duplicate 指定 | `duplicate` |
