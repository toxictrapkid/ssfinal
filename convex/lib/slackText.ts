/**
 * Slack message-text escaping (pure, dependency-free — vitest-covered).
 *
 * Slack `text` uses `mrkdwn`, where `&`, `<`, and `>` are control characters:
 * `<!channel>` is a broadcast ping and `<url|label>` is a link. Scraped seller
 * text (listing titles, locations) flows straight into our webhook payloads, so
 * an attacker who posts a KSL listing titled `<!channel> <https://evil|clickme>`
 * could ping the whole channel and render a spoofed link in the owner's Slack.
 * Per Slack's own guidance, escape exactly these three characters (and only
 * these — over-escaping breaks legitimate `&` in copy) on any interpolated,
 * externally-sourced value before it enters a message. Our own intentional
 * `<url|label>` markup is built from these escaped pieces, so it stays intact.
 */
export function slackEscape(s: string | null | undefined): string {
  if (s == null) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
