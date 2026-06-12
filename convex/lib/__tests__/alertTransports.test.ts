import { describe, expect, it } from "vitest";
import {
  alertBody,
  alertSubject,
  decideChannels,
  sendEmailViaResend,
  sendSmsViaTwilio,
} from "../alertTransports";

function fakeFetch(script: Array<{ status?: number; fail?: boolean }>) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, init });
    const step = script.shift() ?? {};
    if (step.fail) throw new Error("network down");
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => "{}",
    };
  };
  return { impl, calls };
}

describe("channel selection (pure)", () => {
  it("keyless deployment -> log channel only (this deployment)", () => {
    expect(decideChannels({ alertEmail: "z@x.com", alertPhone: "+1801" })).toEqual({
      email: null,
      sms: null,
      log: true,
    });
  });
  it("resend key + email -> email; no contact -> no channel", () => {
    expect(decideChannels({ resendKey: "re_1", alertEmail: "z@x.com" }).email).toBe("z@x.com");
    expect(decideChannels({ resendKey: "re_1" }).log).toBe(true);
  });
  it("twilio needs sid+token+from+phone, all four", () => {
    const base = { twilioSid: "AC1", twilioToken: "t", twilioFrom: "+1800", alertPhone: "+1801" };
    expect(decideChannels(base).sms).toBe("+1801");
    expect(decideChannels({ ...base, twilioFrom: null }).sms).toBeNull();
  });
  it("email + sms together; log floor drops away", () => {
    const plan = decideChannels({
      resendKey: "re_1",
      alertEmail: "z@x.com",
      twilioSid: "AC1",
      twilioToken: "t",
      twilioFrom: "+1800",
      alertPhone: "+1801",
    });
    expect(plan).toEqual({ email: "z@x.com", sms: "+1801", log: false });
  });
});

describe("resend transport envelope", () => {
  it("bearer auth, JSON body, /emails endpoint", async () => {
    const { impl, calls } = fakeFetch([{}]);
    const result = await sendEmailViaResend({
      apiKey: "re_123",
      to: "zaki@example.com",
      subject: "🔥 HOT: 2021 Traverse",
      html: "<p>deal</p>",
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers.Authorization).toBe("Bearer re_123");
    const body = JSON.parse(calls[0].init.body);
    expect(body.to).toEqual(["zaki@example.com"]);
    expect(body.subject).toContain("HOT");
  });
  it("4xx fails fast without retry; 5xx retries", async () => {
    const bad = fakeFetch([{ status: 401 }]);
    const rejected = await sendEmailViaResend({
      apiKey: "bad", to: "a@b.c", subject: "s", html: "h", fetchImpl: bad.impl,
    });
    expect(rejected.ok).toBe(false);
    expect(bad.calls).toHaveLength(1); // no retry on auth failure

    const flaky = fakeFetch([{ status: 503 }, {}]);
    const recovered = await sendEmailViaResend({
      apiKey: "k", to: "a@b.c", subject: "s", html: "h", fetchImpl: flaky.impl,
    });
    expect(recovered.ok).toBe(true);
    expect(flaky.calls).toHaveLength(2);
  }, 15_000);
});

describe("twilio transport envelope", () => {
  it("basic auth + FORM encoding (not JSON) + account-scoped endpoint", async () => {
    const { impl, calls } = fakeFetch([{}]);
    const result = await sendSmsViaTwilio({
      accountSid: "AC42",
      authToken: "tok",
      from: "+18005551212",
      to: "+18015551234",
      body: "🔧 SPECIAL: Terrain",
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC42/Messages.json");
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${btoa("AC42:tok")}`);
    expect(calls[0].init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(calls[0].init.body);
    expect(form.get("To")).toBe("+18015551234");
    expect(form.get("From")).toBe("+18005551212");
    expect(form.get("Body")).toContain("SPECIAL");
  });
});

describe("message content", () => {
  it("subject tags hot vs special and carries profit", () => {
    expect(alertSubject("hot", "2021 Traverse", 4681)).toBe("🔥 HOT: 2021 Traverse (+$4,681 est)");
    expect(alertSubject("mechanic_special", "2017 Terrain")).toBe("🔧 SPECIAL: 2017 Terrain");
  });
  it("body escapes seller-controlled text in html", () => {
    const body = alertBody({
      title: "<script>x</script> Traverse",
      price: 17900,
      url: "https://cars.ksl.com/listing/1",
    });
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script");
    expect(body.text).toContain("Asking $17,900");
  });
});
