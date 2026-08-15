// Tests for scripts/notion-sync-on-open.mjs
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./notion-sync-on-open.mjs";

const ISSUE_URL = "https://github.com/AoiNotion/Aoi_test/issues/42";

function env(overrides = {}) {
  return {
    NOTION_TOKEN: "secret_test",
    NOTION_DATABASE_ID: "db_test",
    ISSUE_URL,
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

test('an opened issue moves a row from "Intake" to "In GitHub"', async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p1", "Intake")]) },
    { match: isPatch, respond: () => ({ body: { id: "p1" } }) },
  ]);

  const result = await run({ env: env(), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 1, skipped: 0 });
  const patch = calls.find((c) => isPatch(c.url, c.options));
  assert.equal(patch.body.properties["対応Status"].status.name, "In GitHub");
  assert.ok(patch.body.properties["Last Synced At"].date.start);
});

test("does NOT overwrite a row that is already past Intake", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p2", "In GitHub")]) },
  ]);

  const result = await run({ env: env(), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 0, skipped: 1 });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)), "must not PATCH a non-Intake row");
});

test("skips a row with no 対応Status set", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p3", null)]) },
  ]);

  const result = await run({ env: env(), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 1, updated: 0, skipped: 1 });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)));
});

test("is a no-op when no row references the issue", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([]) },
  ]);

  const result = await run({ env: env(), fetchImpl, logger: silent });

  assert.deepEqual(result, { matched: 0, updated: 0, skipped: 0 });
  assert.ok(!calls.some((c) => isPatch(c.url, c.options)), "must not PATCH anything");
});

test("filters the query by the exact GitHub Issue URL", async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { match: isQuery, respond: () => queryResult([pageWithStatus("p5", "Intake")]) },
    { match: isPatch, respond: () => ({ body: { id: "p5" } }) },
  ]);

  await run({ env: env(), fetchImpl, logger: silent });

  const query = calls.find((c) => isQuery(c.url));
  assert.equal(query.body.filter.property, "GitHub Issue URL");
  assert.equal(query.body.filter.url.equals, ISSUE_URL);
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
