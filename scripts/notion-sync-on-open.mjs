// Syncs a newly-opened GitHub issue back to the Notion "Product Requests DB".
//
// When a GitHub issue is opened, this finds the Product Requests row whose
// "GitHub Issue URL" matches the issue and, ONLY if its "対応Status" is still
// "Intake", moves it to "In GitHub". Rows already past Intake are left as-is
// (idempotent; never overwrites a later human/GitHub-driven state).
//
// This is an ADDITIVE rule. It does not modify the existing close/comment sync.
// The matching key is the GitHub Issue URL, mirroring the existing
// Salesforce → Notion → GitHub design (see docs/notion-github-agent-design.md).
//
// Run directly from CI:  node scripts/notion-sync-on-open.mjs
// Required env: NOTION_TOKEN, ISSUE_URL
// Optional env: NOTION_DATABASE_ID, NOTION_VERSION, NOTION_SOURCE_STATUS,
//               NOTION_TARGET_STATUS, NOTION_STATUS_PROPERTY,
//               NOTION_GITHUB_URL_PROPERTY, NOTION_LAST_SYNCED_PROPERTY

import { pathToFileURL } from "node:url";

export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const token = env.NOTION_TOKEN;
  const databaseId = env.NOTION_DATABASE_ID || "f8b5709430f24ef4a476fd50bf11aed1";
  const issueUrl = env.ISSUE_URL;
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const sourceStatus = env.NOTION_SOURCE_STATUS || "Intake";
  const targetStatus = env.NOTION_TARGET_STATUS || "In GitHub";
  const statusProp = env.NOTION_STATUS_PROPERTY || "対応Status";
  const urlProp = env.NOTION_GITHUB_URL_PROPERTY || "GitHub Issue URL";
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

  // 2. Only advance rows that are still at the source status ("Intake").
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
          [lastSyncedProp]: { date: { start: new Date().toISOString() } },
        },
      }),
    });
    logger.log(`Updated ${page.id}: ${statusProp} "${current}" -> "${targetStatus}".`);
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
