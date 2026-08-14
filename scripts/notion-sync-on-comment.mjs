// Reacts to GitHub issue comments and moves the matching Notion
// "Product Requests DB" row's 対応Status accordingly.
//
// On an OPEN issue, a comment whose whole body is:
//   "Check" -> 対応Status = "Approved for Dev"
//   "OK"    -> 対応Status = "In Progress"
// Matching is case-insensitive and trims surrounding whitespace; any other
// comment (or a non-open issue) is a no-op. The row is found via the
// "GitHub Issue URL" property, the same key used elsewhere in this repo.
//
// Run directly from CI:  node scripts/notion-sync-on-comment.mjs
// Required env: NOTION_TOKEN, ISSUE_URL
// Optional env: ISSUE_STATE, COMMENT_BODY, NOTION_DATABASE_ID, NOTION_VERSION,
//               NOTION_STATUS_PROPERTY, NOTION_GITHUB_URL_PROPERTY,
//               NOTION_LAST_SYNCED_PROPERTY

import { pathToFileURL } from "node:url";

// Comment command (lower-cased, trimmed) -> target 対応Status value.
const COMMAND_TO_STATUS = new Map([
  ["check", "Approved for Dev"],
  ["ok", "In Progress"],
]);

export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const token = env.NOTION_TOKEN;
  const databaseId = env.NOTION_DATABASE_ID || "f8b5709430f24ef4a476fd50bf11aed1";
  const issueUrl = env.ISSUE_URL;
  const issueState = env.ISSUE_STATE; // "open" | "closed" | undefined
  const commentBody = env.COMMENT_BODY ?? "";
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const statusProp = env.NOTION_STATUS_PROPERTY || "対応Status";
  const urlProp = env.NOTION_GITHUB_URL_PROPERTY || "GitHub Issue URL";
  const lastSyncedProp = env.NOTION_LAST_SYNCED_PROPERTY || "Last Synced At";

  if (!token) throw new Error("NOTION_TOKEN is required");
  if (!issueUrl) throw new Error("ISSUE_URL is required");

  const noop = { matched: 0, updated: 0, skipped: 0, command: null };

  // Only act on open issues.
  if (issueState && issueState !== "open") {
    logger.log(`Issue is not open (state=${issueState}); skipping.`);
    return noop;
  }

  // Only act on the recognized command comments.
  const command = commentBody.trim().toLowerCase();
  const targetStatus = COMMAND_TO_STATUS.get(command);
  if (!targetStatus) {
    logger.log(`Comment is not a recognized command ("Check"/"OK"); skipping.`);
    return noop;
  }

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

  // Find every Product Requests row that references this issue.
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
    return { matched: 0, updated: 0, skipped: 0, command };
  }

  let updated = 0;
  for (const page of pages) {
    const current = page.properties?.[statusProp]?.status?.name ?? null;
    await notion(`/pages/${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [statusProp]: { status: { name: targetStatus } },
          [lastSyncedProp]: { date: { start: new Date().toISOString() } },
        },
      }),
    });
    logger.log(
      `Updated ${page.id}: ${statusProp} "${current}" -> "${targetStatus}" (comment "${command}").`,
    );
    updated++;
  }

  logger.log(`Done. command="${command}" matched=${pages.length} updated=${updated}.`);
  return { matched: pages.length, updated, skipped: 0, command };
}

// Execute only when invoked as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
