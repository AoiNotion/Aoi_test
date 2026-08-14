// Tests for scripts/notion-sync-on-comment.mjs
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./notion-sync-on-comment.mjs";

const ISSUE_URL = "https://github.com/AoiNotion/Aoi_test/issues/42";

function env(overrides = {}) {
  return {
    NOTION_TOKEN: "secret_test",
    NOTION_DATABASE_ID: "db_test",
    ISSUE_URL,
    ISSUE_STATE: "open",
    ...overrides,
  };
}

const silent = { log() {} };

function makeFakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    for (const h of handlers) {
      if (h.match(url, options)) {
        const r = h.respond ? h.respond(url, options) : {};
        return {
          ok: r.ok ?? true,
          status: r.status ?? 200,
          text: async () => JSON.stringify(r.body ?? {}),
        };
      }
    }
    throw new Error(`No fake handler for ${options.method || "GET"} ${url}`);
  };
  return { fetchImpl, calls };
}

const isQuery = (url) => url.includes("/databases/") && url.includes("/query");
const isPatch = (url, o) => url.includes("/pages/") && o.method === "PATCH";

function queryResult(pages) {
  return { body: { results: pages, has_more: false, next_cursor: null } };
}
function pageWithStatus(id, statusName) {
  return { id, properties: { "対応Status": { status: statusName ? { name: statusName } : null } } };
}

test('"Check" on an open issue sets 対応Status = Approved for Dev', async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p1", "In GitHub")]) },
    { match: isPatch, respond: () => ({ body: { id: "p1" } }) },
  ]);

  const result = await run({ env: env({ COMMENT_BODY: "Check" }), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 1, skipped: 0, command: "check" });
  const patch = calls.find((c) => isPatch(c.url, c.options));
  assert.equal(patch.body.properties["対応Status"].status.name, "Approved for Dev");
  assert.ok(patch.body.properties["Last Synced At"].date.start);
});

test('"OK" on an open issue sets 対応Status = In Progress (case/space insensitive)', async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p2", "Approved for Dev")]) },
    { match: isPatch, respond: () => ({ body: { id: "p2" } }) },
  ]);

  const result = await run({ env: env({ COMMENT_BODY: "  ok\n" }), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 1, skipped: 0, command: "ok" });
  const patch = calls.find((c) => isPatch(c.url, c.options));
  assert.equal(patch.body.properties["対応Status"].status.name, "In Progress");
});

test("ignores comments that are not a recognized command", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p3", "In GitHub")]) },
  ]);

  const result = await run({ env: env({ COMMENT_BODY: "looks good to me" }), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 0, updated: 0, skipped: 0, command: null });
  assert.ok(!calls.some((c) => isQuery(c.url)), "must not even query Notion for non-commands");
});

test("does nothing when the issue is not open", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p4", "In GitHub")]) },
  ]);

  const result = await run({
    env: env({ COMMENT_BODY: "Check", ISSUE_STATE: "closed" }),
    fetchImpl,
    logger: silent,
  });

  assert.deepEqual(result, { matched: 0, updated: 0, skipped: 0, command: null });
  assert.ok(!calls.length, "must not call Notion for a closed issue");
});

test("is a no-op when no row references the issue", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([]) },
  ]);

  const result = await run({ env: env({ COMMENT_BODY: "OK" }), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 0, updated: 0, skipped: 0, command: "ok" });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)), "must not PATCH anything");
});

test("filters the query by the exact GitHub Issue URL", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p5", "In GitHub")]) },
    { match: isPatch, respond: () => ({ body: { id: "p5" } }) },
  ]);

  await run({ env: env({ COMMENT_BODY: "Check" }), fetchImpl, logger: silent });

  const query = calls.find((c) => isQuery(c.url));
  assert.equal(query.body.filter.property, "GitHub Issue URL");
  assert.equal(query.body.filter.url.equals, ISSUE_URL);
});

test("requires NOTION_TOKEN and ISSUE_URL", async () => {
  await assert.rejects(
    () => run({ env: { ISSUE_URL, COMMENT_BODY: "Check" }, fetchImpl: async () => {}, logger: silent }),
    /NOTION_TOKEN is required/,
  );
  await assert.rejects(
    () => run({ env: { NOTION_TOKEN: "x", COMMENT_BODY: "Check" }, fetchImpl: async () => {}, logger: silent }),
    /ISSUE_URL is required/,
  );
});
