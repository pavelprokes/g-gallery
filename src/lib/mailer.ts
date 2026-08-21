import "server-only";

/**
 * One send() with two backends, picked by which env vars are set.
 *
 *   RESEND_API_KEY -> Resend HTTPS API (production; free tier 3 000/mo, 100/day)
 *   SMTP_URL       -> SMTP (local dev; the Mailpit container, inbox on :8025)
 *   neither        -> logged and skipped, so a missing key never breaks a cron
 *
 * Resend is an HTTP API rather than SMTP, so it cannot be pointed at Mailpit —
 * hence two implementations rather than one transport with a different host.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailResult =
  | { sent: true; via: "resend" | "smtp" }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

const FROM = process.env.MAIL_FROM ?? "g-gallery <onboarding@resend.dev>";

export async function sendMail(mail: Mail): Promise<MailResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) return sendViaResend(mail, resendKey);

  const smtpUrl = process.env.SMTP_URL;
  if (smtpUrl) return sendViaSmtp(mail, smtpUrl);

  console.warn("[mailer] neither RESEND_API_KEY nor SMTP_URL set — skipping", mail.subject);
  return { sent: false, reason: "not_configured" };
}

async function sendViaResend(mail: Mail, apiKey: string): Promise<MailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });

    if (!response.ok) {
      // The body carries Resend's reason (bad domain, over quota); keep it.
      return {
        sent: false,
        reason: "failed",
        detail: `${response.status} ${await response.text()}`,
      };
    }
    return { sent: true, via: "resend" };
  } catch (error) {
    return { sent: false, reason: "failed", detail: (error as Error).message };
  }
}

async function sendViaSmtp(mail: Mail, smtpUrl: string): Promise<MailResult> {
  try {
    // Imported lazily so the SMTP client is never bundled into a deployment
    // that only ever uses Resend.
    const { createTransport } = await import("nodemailer");
    const transport = createTransport(smtpUrl);
    await transport.sendMail({
      from: FROM,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return { sent: true, via: "smtp" };
  } catch (error) {
    return { sent: false, reason: "failed", detail: (error as Error).message };
  }
}
