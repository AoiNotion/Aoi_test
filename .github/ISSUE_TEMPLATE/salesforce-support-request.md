---
name: Salesforce Support Request
about: Notion 上でトリアージ済みのサポートリクエストを起票するための標準テンプレート（Notion カスタムエージェントが本文をこの形式で生成します）
title: ""
labels: ""
assignees: ""
---

<!--
この Issue は Notion のサポートリクエスト DB から自動起票されます。
起票トリガー: Approval が Approved になったとき（Pending → Approved）。
起票条件（すべて満たす）:
  - Approval   = Approved
  - GitHub Issue URL が空（＝二重起票防止の突合キー）
  - Request Type ∈ { Bug, Feature Request, Improvement }
タイトルには Notion の `Request` をそのまま使用します。
-->

## Summary
<!-- Notion: Engineering Brief の要約。1〜2 文で対応内容を記載 -->

## Customer Impact
- Account: <!-- 顧客アカウント名 -->
- Segment: <!-- Enterprise / Mid-Market / SMB など -->
- Priority: <!-- Notion: Priority -->
- Impact: <!-- Notion: Customer Impact。影響範囲・緊急度 -->

## Request Details
<!-- Notion: Engineering Brief の本文。背景・再現手順・期待挙動など -->

## Acceptance Criteria
- [ ] <!-- Notion: Acceptance Criteria の各項目 -->
- [ ] 

## Links
- Notion Request: <!-- Notion: Notion URL -->
- Salesforce Case: <!-- Notion: Salesforce Case ID（可能ならリンク） -->
