/**
 * Alert delivery transports — Resend (email) and Twilio (SMS).
 *
 * Fetch-injectable for tests; retry with backoff on 5xx/network, fail fast on
 * 4xx (bad keys don't heal). Keyless deployments (this one — user directive:
 * no additional access) never reach these: alerts.ts falls back to the "log"
 * channel, which still writes the alert row so dedupe stays real.
 */

export interface TransportResult {
  ok: boolean;
  detail: string;
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const RETRIES = 3;
const BACKOFF_MS = [2000, 4000];

async function postWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: { headers: Record<string, string>; body: string },
  what: string
): Promise<TransportResult> {
  let lastDetail = "";
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetchImpl(url, { method: "POST", ...init });
      if (response.ok) return { ok: true, detail: `${what} sent` };
      const body = (await response.text()).slice(0, 200);
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, detail: `${what} rejected (${response.status}): ${body}` };
      }
      lastDetail = `${what} ${response.status}: ${body}`;
    } catch (error) {
      lastDetail = `${what} network error: ${String(error)}`;
    }
    if (attempt < RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  }
  return { ok: false, detail: `${lastDetail} (after ${RETRIES} attempts)` };
}

export async function sendEmailViaResend(args: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
  from?: string;
  fetchImpl?: FetchLike;
}): Promise<TransportResult> {
  return postWithRetry(
    args.fetchImpl ?? (fetch as unknown as FetchLike),
    "https://api.resend.com/emails",
    {
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from ?? "CarHunter <alerts@resend.dev>",
        to: [args.to],
        subject: args.subject,
        html: args.html,
      }),
    },
    "resend email"
  );
}

export async function sendSmsViaTwilio(args: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
  fetchImpl?: FetchLike;
}): Promise<TransportResult> {
  // Twilio is form-encoded with HTTP basic auth — NOT JSON
  const form = new URLSearchParams({
    From: args.from,
    To: args.to,
    Body: args.body,
  });
  // btoa is available in the Convex isolate runtime
  const basic = btoa(`${args.accountSid}:${args.authToken}`);
  return postWithRetry(
    args.fetchImpl ?? (fetch as unknown as FetchLike),
    `https://api.twilio.com/2010-04-01/Accounts/${args.accountSid}/Messages.json`,
    {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
    "twilio sms"
  );
}

export interface ChannelPlan {
  email: string | null; // address to send to, when deliverable
  sms: string | null; // phone to send to, when deliverable
  log: boolean; // always true when nothing else is deliverable
}

/** Pure channel selection: keys + contact info decide delivery; the log
 * channel is the floor so an alert is never silently dropped. */
export function decideChannels(env: {
  resendKey?: string | null;
  twilioSid?: string | null;
  twilioToken?: string | null;
  twilioFrom?: string | null;
  alertEmail?: string | null;
  alertPhone?: string | null;
}): ChannelPlan {
  const email = env.resendKey && env.alertEmail ? env.alertEmail : null;
  const sms =
    env.twilioSid && env.twilioToken && env.twilioFrom && env.alertPhone
      ? env.alertPhone
      : null;
  return { email, sms, log: !email && !sms };
}

export function alertSubject(reason: string, title: string, profit?: number): string {
  const tag = reason === "mechanic_special" ? "🔧 SPECIAL" : "🔥 HOT";
  const money =
    profit !== undefined ? ` (+$${Math.round(profit).toLocaleString()} est)` : "";
  return `${tag}: ${title}${money}`;
}

export function alertBody(listing: {
  title: string;
  price: number;
  estProfit?: number;
  estValue?: number;
  dealScore?: number;
  url: string;
}): { text: string; html: string } {
  const lines = [
    listing.title,
    `Asking $${listing.price.toLocaleString()}`,
    listing.estValue !== undefined ? `Est. value $${listing.estValue.toLocaleString()}` : null,
    listing.estProfit !== undefined
      ? `Est. profit ${listing.estProfit >= 0 ? "+" : ""}$${listing.estProfit.toLocaleString()}`
      : null,
    listing.dealScore !== undefined ? `Score ${listing.dealScore}/100` : null,
    listing.url,
  ].filter(Boolean) as string[];
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    text: lines.join("\n"),
    html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
  };
}
