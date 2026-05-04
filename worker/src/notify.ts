import type { Env } from "./types";

function publicOrigin(env: Env): string {
  const u =
    (env.PUBLIC_SITE_URL || env.ALLOWED_ORIGIN || "https://katalog-uslug.pro")
      .replace(/\/$/, "")
      .trim() || "https://katalog-uslug.pro";
  return u;
}

export async function sendResendEmail(env: Env, opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "resend_not_configured" };
  const from =
    env.EMAIL_FROM?.trim() || "Katalog <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: t.slice(0, 400) || `http_${r.status}` };
  }
  return { ok: true };
}

export function verificationEmailHtml(
  env: Env,
  apiVerifyUrl: string
): string {
  const site = publicOrigin(env);
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>Здравствуйте!</p>
<p>Подтвердите адрес электронной почты для аккаунта на <strong>katalog-uslug.pro</strong>:</p>
<p><a href="${apiVerifyUrl}" style="display:inline-block;padding:12px 20px;background:#2F4B6A;color:#fff;border-radius:8px;text-decoration:none">Подтвердить почту</a></p>
<p>Если кнопка не открывается, скопируйте ссылку:<br/><span style="word-break:break-all;font-size:13px">${apiVerifyUrl}</span></p>
<p style="color:#666;font-size:13px">Если вы не регистрировались — просто проигнорируйте письмо.</p>
<p style="color:#666;font-size:13px">${site}</p>
</body></html>`;
}

export function passwordResetEmailHtml(
  env: Env,
  resetUrl: string
): string {
  const site = publicOrigin(env);
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>Сброс пароля на katalog-uslug.pro</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#2F4B6A;color:#fff;border-radius:8px;text-decoration:none">Задать новый пароль</a></p>
<p style="word-break:break-all;font-size:13px">${resetUrl}</p>
<p style="color:#666;font-size:13px">Ссылка действует ограниченное время. Если это не вы — игнорируйте письмо.</p>
<p style="color:#666;font-size:13px">${site}</p>
</body></html>`;
}

/** SMS.RU — код входа / привязки телефона */
export async function sendSmsRu(
  env: Env,
  phoneDigits: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiId = env.SMSRU_API_ID?.trim();
  if (!apiId) return { ok: false, error: "sms_not_configured" };
  const to = phoneDigits.replace(/\D/g, "");
  const u = new URL("https://sms.ru/sms/send");
  u.searchParams.set("api_id", apiId);
  u.searchParams.set("to", to);
  u.searchParams.set("msg", text);
  u.searchParams.set("json", "1");
  const r = await fetch(u.toString(), { method: "GET" });
  if (!r.ok) return { ok: false, error: `sms_http_${r.status}` };
  const j = (await r.json()) as { status?: string; status_code?: number };
  if (String(j.status) === "OK" || j.status_code === 100) return { ok: true };
  return { ok: false, error: JSON.stringify(j).slice(0, 300) };
}
