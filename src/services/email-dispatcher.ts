import nodemailer from "nodemailer";

interface SendEmailOptions {
  to: string[];
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64 string content
  }>;
}

export async function sendEodEmail(
  options: SendEmailOptions,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { to, subject, html } = options;

  if (!to || to.length === 0) {
    return { success: false, error: "No recipient emails specified" };
  }

  // 1. Try SMTP if configured (Gmail / Google Workspace / Custom SMTP) — allows sending to ANY recipient email!
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const port = Number(process.env.SMTP_PORT) || 465;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || `Daily Flow Digest <${smtpUser}>`,
        to,
        subject,
        html,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, "base64"),
        })),
      });

      console.log(
        `[EmailDispatcher] Sent via SMTP to ${to.join(", ")}. MessageId: ${info.messageId}`,
      );
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error("SMTP Delivery Error:", err);
      return { success: false, error: `SMTP Error: ${(err as Error).message}` };
    }
  }

  // 2. Fallback to Resend API
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey && resendApiKey.trim() !== "") {
    try {
      const fromEmail = process.env.EMAIL_FROM || "onboarding@resend.dev";
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to,
          subject,
          html,
          attachments: options.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
          })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Resend API Email Delivery Error:", errText);
        return { success: false, error: `Resend API Error: ${errText}` };
      }

      const resData = (await response.json()) as { id?: string };
      console.log(
        `[EmailDispatcher] Sent via Resend to ${to.join(", ")}. MessageId: ${resData.id}`,
      );
      return { success: true, messageId: resData.id };
    } catch (err) {
      console.error("Failed to send email via Resend:", err);
      return { success: false, error: (err as Error).message };
    }
  }

  return {
    success: false,
    error: "No email provider (SMTP or RESEND_API_KEY) configured in .env file.",
  };
}
