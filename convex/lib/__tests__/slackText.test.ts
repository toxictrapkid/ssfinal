import { describe, expect, it } from "vitest";
import { slackEscape } from "../slackText";

describe("slackEscape (Slack mrkdwn injection guard)", () => {
  it("escapes the three Slack control characters", () => {
    expect(slackEscape("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(slackEscape("<b>")).toBe("&lt;b&gt;");
    expect(slackEscape("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("neutralizes a scraped channel-ping injection so it can't broadcast", () => {
    const escaped = slackEscape("<!channel> everyone look");
    expect(escaped).toBe("&lt;!channel&gt; everyone look");
    expect(escaped.includes("<!channel>")).toBe(false);
  });

  it("neutralizes a spoofed-link injection", () => {
    const escaped = slackEscape("<https://evil.example|Open record>");
    expect(escaped.includes("<https://evil.example|")).toBe(false);
    expect(escaped).toBe("&lt;https://evil.example|Open record&gt;");
  });

  it("leaves legitimate listing text untouched", () => {
    expect(slackEscape("2019 Honda Civic EX — Salt Lake City, UT")).toBe(
      "2019 Honda Civic EX — Salt Lake City, UT"
    );
  });

  it("handles null/undefined as empty string", () => {
    expect(slackEscape(null)).toBe("");
    expect(slackEscape(undefined)).toBe("");
    expect(slackEscape("")).toBe("");
  });

  it("escapes & before < and > so nothing is double-encoded into a false control char", () => {
    // "&lt;" typed by a seller must not become a literal "<" after escaping
    expect(slackEscape("&lt;")).toBe("&amp;lt;");
  });
});
