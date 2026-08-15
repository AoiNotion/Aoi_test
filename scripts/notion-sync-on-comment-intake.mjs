// Reacts to a GitHub issue comment and, ONLY when the matching Notion
// "Product Requests DB" row's 対応Status is currently "In GitHub", moves that
// row to "Fixed" and mirrors "GitHub Status" = "Closed".
//
// Flow: an issue opened by the approval gate first becomes "In GitHub"
// (scripts/notion-sync-on-open.mjs). When a human then comments on that issue,
// this rule advances the row to "Fixed" and sets "GitHub Status" = "Closed".
//
// This is an ADDITIVE rule. It does NOT modify the existing comment sync
// (scripts/notion-sync-on-comment.mjs, which maps the "Check"/"OK" commands),
// and it runs from its own workflow with its own concurrency group.
//
// The matching key is the GitHub Issue URL (see docs/notion-github-agent-design.md).
//
// Run directly from CI:  node scripts/notion-sync-on-comment-intake.mjs
// Required env: NOTION_TOKEN, ISSUE_URL
// Optional env: NOTION_DATABASE_ID, NOTION_VERSION, NOTION_SOURCE_STATUS,
//               NOTION_TARGET_STATUS, NOTION_STATUS_PROPERTY,
//               NOTION_GITHUB_URL_PROPERTY, NOTION_GITHUB_STATUS_PROPERTY,
//               NOTION_GITHUB_STATUS_VALUE, NOTION_LAST_SYNCED_PROPERTY

import { pathToFileURL } from "node:url";

export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const token = env.NOTION_TOKEN;
  const databaseId = env.NOTION_DATABASE_ID || "3cdb35e6e67f82de8ce181dc217f10f8";
  const issueUrl = env.ISSUE_URL;
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const sourceStatus = env.NOTION_SOURCE_STATUS || "In GitHub";
  const targetStatus = env.NOTION_TARGET_STATUS || "Fixed";
  const statusProp = env.NOTION_STATUS_PROPERTY || "対応Status";
  const urlProp = env.NOTION_GITHUB_URL_PROPERTY || "GitHub Issue URL";
  const githubStatusProp = env.NOTION_GITHUB_STATUS_PROPERTY || "GitHub Status";
  const githubStatusValue = env.NOTION_GITHUB_STATUS_VALUE || "Closed";
  const lastSyncedProp = env.NOTION_LAST_SYNCED_PROPERTY || "Last Synced At";

  if (!token) throw new Error("NOTION_TOKEN is required");
  if (!issueUrl) throw new Error("ISSUE_URL is required");

  async function notion(path, options = {}) {
    const res = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const method = options.method || "GET";
      throw new Error(
        `Notion API ${method} ${path} failed: ${res.status} ${body.message || text}`,
      );
    }
    return body;
  }

  // 1. Find every Product Requests row that references this issue.
  const pages = [];
  let cursor;
  do {
    const query = {
      filter: { property: urlProp, url: { equals: issueUrl } },
      page_size: 100,
    };
    if (cursor) query.start_cursor = cursor;
    const data = await notion(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(query),
    });
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  if (pages.length === 0) {
    logger.log(`No Product Requests row matches ${issueUrl}; nothing to update.`);
    return { matched: 0, updated: 0, skipped: 0 };
  }

  // 2. Only advance rows that are currently at the source status ("In GitHub").
  let updated = 0;
  let skipped = 0;
  for (const page of pages) {
    const current = page.properties?.[statusProp]?.status?.name ?? null;
    if (current !== sourceStatus) {
      logger.log(
        `Skip ${page.id}: ${statusProp} is "${current}", not "${sourceStatus}".`,
      );
      skipped++;
      continue;
    }
    await notion(`/pages/${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [statusProp]: { status: { name: targetStatus } },
          [githubStatusProp]: { select: { name: githubStatusValue } },
          [lastSyncedProp]: { date: { start: new Date().toISOString() } },
        },
      }),
    });
    logger.log(
      `Updated ${page.id}: ${statusProp} "${current}" -> "${targetStatus}", ${githubStatusProp} -> "${githubStatusValue}".`,
    );
    updated++;
  }

  logger.log(
    `Done. matched=${pages.length} updated=${updated} skipped=${skipped}.`,
  );
  return { matched: pages.length, updated, skipped };
}

// Execute only when invoked as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
