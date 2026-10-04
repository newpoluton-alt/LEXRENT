import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
import { app } from "../../src/server/api";
import { challengeData, properties } from "../../src/domain";
const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { delete process.env.DATABASE_URL; delete process.env.NEON_AUTH_BASE_URL; delete process.env.NEON_AUTH_COOKIE_SECRET; delete process.env.ANTHROPIC_API_KEY; });

describe("monolith API", () => {
  it("loads real challenge counts and state-filtered pagination", async () => {
    const dashboard = await (await app.request("/api/dashboard")).json();
    expect(dashboard.counts).toMatchObject({ properties: 500, sources: challengeData.sources.length, captured_sources: challengeData.sources.filter(source => source.captured).length, rules: challengeData.verifiedRules.length });
    expect(dashboard.counts.rules).toBeGreaterThan(0);
    const response = await (await app.request("/api/properties?state=NJ&limit=12&page=2")).json();
    expect(response.total).toBe(140); expect(response.properties).toHaveLength(12);
    expect(response.properties.every((property: { state: string }) => property.state === "NJ")).toBe(true);
  });
  it("serves evidence-backed seeded lookup results while preserving incomplete coverage", async () => {
    const response = await app.request("/api/lookup", post({ address_id: properties[0].address_id }));
    const result = await response.json(); expect(response.status).toBe(200);
    expect(result.coverage_complete).toBe(false); expect(result.rule_count).toBeGreaterThan(0);
    expect(result.jurisdiction.verified).toBe(Boolean(challengeData.jurisdictionResolutions?.[properties[0].address_id]?.verified));
    expect(result.results.some((rule: { result: string; rule: { level: string } }) => rule.result === "applies" && rule.rule.level === "state")).toBe(true);
    expect(result.results.every((rule: { evidence: unknown }) => rule.evidence !== null)).toBe(true);
  });
  it("rejects impossible dates, wrongly typed facts and fabricated city facts", async () => {
    for (const body of [{ as_of: "2026-02-30" }, { facts: { units: "5" } }, { facts: { legal_city: "Boston" } }]) {
      const response = await app.request("/api/lookup", post({ address_id: properties[0].address_id, ...body }));
      expect(response.status).toBe(400);
    }
  });
  it("rejects cross-site mutations before authentication or any database call", async () => {
    const response = await app.request("https://lexrent.example/api/saved", post({ address_id: properties[0].address_id }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
  });
  it("requires real server sessions for saved work and admin/AI mutations", async () => {
    for (const route of ["saved", "admin/rules", "admin/vector-index", "ai/extract"]) {
      expect((await app.request(`/api/${route}`, post({}))).status).toBe(503);
    }
    expect((await app.request("/api/me")).status).toBe(200);
  });
  it("exports all 500 IDs and keeps artifact readiness distinct from complete legal coverage", async () => {
    const response = await app.request("/api/exports/lookups?as_of=2026-10-01");
    const body = await response.json(); expect(Object.keys(body.lookups)).toHaveLength(500);
    expect(response.headers.get("content-disposition")).toContain("lookups.json");
    expect(response.headers.get("x-lexrent-submission-ready")).toBe("true");
    const readiness = await (await app.request("/api/exports/readiness?as_of=2026-10-01")).json();
    expect(readiness).toMatchObject({ ready: true });
    const coverage = await (await app.request("/api/coverage")).json();
    expect(coverage.coverage_complete).toBe(false);
  });
  it("evaluates seeded cases and preserves the fixture expectations separately", async () => {
    const body = await (await app.request("/api/changes")).json(); expect(body.tests).toHaveLength(5);
    expect(body.evaluations.every((test: { evaluation_status: string; missing_rule_ids: string[] }) => test.evaluation_status !== "not_evaluated" && test.missing_rule_ids.length === 0)).toBe(true);
    expect(body.tests.map((test: { test_id: string }) => test.test_id)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(body.evaluations.find((test: { test_id: string }) => test.test_id === "T5").affected_address_ids).toEqual([]);
  });
});
