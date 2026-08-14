// Tests for scripts/notion-sync-on-close.mjs
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./notion-sync-on-close.mjs";

const ISSUE_URL = "https://github.com/AoiNotion/Aoi_test/issues/42";
const BASE_ENV = {
  NOTION_TOKEN: "secret_test",
  NOTION_DATABASE_ID: "db_test",
  ISSUE_URL,
};

const silent = { log() {} };

// Build a fake fetch whose behaviour is driven by simple handlers. Each call
// is recorded so tests can assert what was sent to the Notion API.
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
  return {
    id,
    properties: { "対応Status": { status: statusName ? { name: statusName } : null } },
  };
}

test("moves a matching in-flight row to Fixed and mirrors GitHub Status", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("page_1", "In Review")]) },
    { match: isPatch, respond: () => ({ body: { id: "page_1" } }) },
  ]);

  const result = await run({ env: BASE_ENV, fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 1, skipped: 0 });
  const patch = calls.find((c) => isPatch(c.url, c.options));
  assert.ok(patch, "expected a PATCH call");
  assert.equal(patch.body.properties["対応Status"].status.name, "Fixed");
  assert.equal(patch.body.properties["GitHub Status"].select.name, "Closed");
  assert.ok(patch.body.properties["Last Synced At"].date.start, "expected Last Synced At stamp");
});

test("does not drag a row that is already past Fixed backwards", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("page_2", "Published")]) },
  ]);

  const result = await run({ env: BASE_ENV, fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 0, skipped: 1 });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)), "must not PATCH a Published row");
});

test("is a no-op when no row references the issue", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([]) },
  ]);

  const result = await run({ env: BASE_ENV, fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 0, updated: 0, skipped: 0 });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)), "must not PATCH anything");
});

test("filters the query by the exact GitHub Issue URL", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("page_3", "In Progress")]) },
    { match: isPatch, respond: () => ({ body: { id: "page_3" } }) },
  ]);

  await run({ env: BASE_ENV, fetchImpl, logger: silent });

  const query = calls.find((c) => isQuery(c.url));
  assert.equal(query.body.filter.property, "GitHub Issue URL");
  assert.equal(query.body.filter.url.equals, ISSUE_URL);
});

test("throws a clear error when Notion returns a failure", async () => {
  const { fetchImpl } = makeFakeFetch([
    { match: isQuery, respond: () => ({ ok: false, status: 401, body: { message: "unauthorized" } }) },
  ]);

  await assert.rejects(
    () => run({ env: BASE_ENV, fetchImpl, logger: silent }),
    /401 unauthorized/,
  );
});

test("requires NOTION_TOKEN and ISSUE_URL", async () => {
  await assert.rejects(
    () => run({ env: { ISSUE_URL }, fetchImpl: async () => {}, logger: silent }),
    /NOTION_TOKEN is required/,
  );
  await assert.rejects(
    () => run({ env: { NOTION_TOKEN: "x" }, fetchImpl: async () => {}, logger: silent }),
    /ISSUE_URL is required/,
  );
});
