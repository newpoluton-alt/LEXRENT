import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLocalSubmission, parseSubmissionExportArgs, writeLocalSubmission } from "../../scripts/export-submission";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("local challenge submission export", () => {
  it("supports the required baseline export without inventing database or alternate-date modes", () => {
    expect(parseSubmissionExportArgs([], "/test")?.outputDir).toBe("/test/submissions");
    expect(parseSubmissionExportArgs(["--output-dir", "output"], "/test")?.outputDir).toBe("/test/output");
    expect(parseSubmissionExportArgs(["--help"])).toBeNull();
    for (const args of [["--live"], ["--as-of", "2027-07-02"], ["--output-dir"], ["--output-dir", "one", "--output-dir", "two"]]) expect(() => parseSubmissionExportArgs(args)).toThrow("SUBMISSION_INVALID_ARGUMENT");
  });

  it("writes the template wrappers, all 500 addresses, distinct uncertainty audit and an exact method note without network access", async () => {
    const network = vi.fn(() => { throw new Error("Network access is forbidden for a local export."); });
    vi.stubGlobal("fetch", network);
    const directory = await mkdtemp(join(tmpdir(), "lexrent-submission-test-")); directories.push(directory);
    const methodPath = join(directory, "input-method.md"), outputDir = join(directory, "submission");
    const note = "# Test method note\n\nExact contents & punctuation stay unchanged.\n";
    await writeFile(methodPath, note);
    const files = buildLocalSubmission();
    const result = await writeLocalSubmission(files, { outputDir, methodNote: methodPath });
    expect(result).toMatchObject({ evaluated_addresses: 500, query_date: "2026-10-01", coverage_complete: false, database_accessed: false, method_note_copied: true });
    expect(await readdir(outputDir)).toEqual(["changes.json", "data-coverage.json", "lookups.json", "method-note.md", "readiness.json", "rules.json"]);
    const rules = JSON.parse(await readFile(join(outputDir, "rules.json"), "utf8"));
    const lookups = JSON.parse(await readFile(join(outputDir, "lookups.json"), "utf8"));
    const changes = JSON.parse(await readFile(join(outputDir, "changes.json"), "utf8"));
    const readiness = JSON.parse(await readFile(join(outputDir, "readiness.json"), "utf8"));
    const coverage = JSON.parse(await readFile(join(outputDir, "data-coverage.json"), "utf8"));
    expect(Object.keys(rules)).toEqual(["rules"]);
    expect(Object.keys(lookups)).toEqual(["as_of", "lookups"]);
    expect(lookups.as_of).toBe("2026-10-01");
    expect(Object.keys(lookups.lookups)).toHaveLength(500);
    for (let index = 1; index <= 500; index++) expect(lookups.lookups).toHaveProperty(`A${String(index).padStart(4, "0")}`);
    expect(Object.keys(changes)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(changes.T5.affected_address_ids).toEqual([]);
    expect(readiness.scope).toBe("local_compiled_corpus");
    expect(readiness.coverage_complete).toBe(false);
    expect(coverage.export_scope).toBe("local_compiled_corpus");
    expect(coverage.change_evaluations).toHaveLength(5);
    expect(coverage.change_evaluations.every((change: { evaluation_status: string; expected_behavior: string }) => typeof change.evaluation_status === "string" && typeof change.expected_behavior === "string")).toBe(true);
    expect(coverage.source_provenance.length).toBeGreaterThan(0);
    expect(coverage.source_provenance.every((source: { retrieved_at: string; sha256: string }) => Number.isFinite(Date.parse(source.retrieved_at)) && /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
    expect(await readFile(join(outputDir, "method-note.md"), "utf8")).toBe(note);
    expect(network).not.toHaveBeenCalled();
    // An optional missing note is reported, rather than creating invented documentation.
    const withoutNote = await writeLocalSubmission(files, { outputDir: join(directory, "no-note"), methodNote: join(directory, "missing.md") });
    expect(withoutNote.method_note_copied).toBe(false);
    expect(await readdir(join(directory, "no-note"))).not.toContain("method-note.md");
  });
});
