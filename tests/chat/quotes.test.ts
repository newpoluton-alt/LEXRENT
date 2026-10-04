import { describe, expect, it } from "vitest";
import { restoreOriginalQuote } from "../../src/domain/quotes";

describe("restoration of retrieved original quotations", () => {
  it("restores only whitespace differences into an exact continuous source span", () => {
    const text = "Header. The tenant\n  may\t request a security deposit. Footer.";
    const restored = restoreOriginalQuote(text, "The tenant may request a security deposit.");
    expect(restored?.quoted_span).toBe("The tenant\n  may\t request a security deposit.");
    expect(text.slice(restored!.start_offset, restored!.end_offset)).toBe(restored!.quoted_span);
  });
  it("accepts a quote jointly covered by contiguous or overlapping retrieved chunks", () => {
    const text = "First section has obligations. Second section has exceptions.";
    const quote = "obligations. Second section";
    expect(restoreOriginalQuote(text, quote, [{ start: 0, end: 30 }, { start: 30, end: text.length }])?.quoted_span).toBe(quote);
    expect(restoreOriginalQuote(text, quote, [{ start: 0, end: 35 }, { start: 25, end: text.length }])?.quoted_span).toBe(quote);
  });
  it("rejects a source quote that crosses an unretrieved gap", () => {
    const text = "First section has obligations. Second section has exceptions.";
    expect(restoreOriginalQuote(text, "obligations. Second section", [{ start: 0, end: 25 }, { start: 35, end: text.length }])).toBeNull();
  });
  it("rejects paraphrases, omissions and punctuation substitutions", () => {
    const text = "The tenant may request a security deposit; a notice is required.";
    expect(restoreOriginalQuote(text, "The tenant can request a security deposit;")).toBeNull();
    expect(restoreOriginalQuote(text, "The tenant ... a notice is required.")).toBeNull();
    expect(restoreOriginalQuote(text, "The tenant may request a security deposit, a notice is required.")).toBeNull();
  });
  it("selects an occurrence within the retrieved region when identical text appears elsewhere", () => {
    const text = "The notice is required. Unretrieved middle. The notice is required.";
    const start = text.lastIndexOf("The notice");
    expect(restoreOriginalQuote(text, "The notice is required.", [{ start, end: text.length }])?.start_offset).toBe(start);
  });
});
