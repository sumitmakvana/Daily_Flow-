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

// In-memory token cache to avoid acquiring a new token on every send
let msTokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  if (msTokenCache && msTokenCache.expiresAt > now + 60000) {
    return msTokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to acquire Microsoft Graph OAuth2 token (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("No access_token returned by Microsoft Identity platform");
  }

  const expiresIn = data.expires_in || 3600;
  msTokenCache = {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
  };

  return data.access_token;
}

async function sendViaMicrosoftGraph(
  options: SendEmailOptions,
  tenantId: string,
  clientId: string,
  clientSecret: string,
  senderEmail: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const token = await getGraphAccessToken(tenantId, clientId, clientSecret);
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;

    const toRecipients = options.to.map((email) => ({
      emailAddress: { address: email.trim() },
    }));

    const attachments = options.attachments?.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentBytes: a.content,
    }));

    const message: Record<string, any> = {
      subject: options.subject,
      body: {
        contentType: "HTML",
        content: options.html,
      },
      toRecipients,
    };

    if (attachments && attachments.length > 0) {
      message.attachments = attachments;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        saveToSentItems: "true",
      }),
    });

    if (res.status === 202 || res.status === 200) {
      console.log(`[EmailDispatcher] Sent via Microsoft Graph API to ${options.to.join(", ")}`);
      return { success: true, messageId: `msgraph-${Date.now()}` };
    }

    const errText = await res.text();
    console.error(`[EmailDispatcher] Microsoft Graph API Error (${res.status}):`, errText);
    return { success: false, error: `Microsoft Graph API Error (${res.status}): ${errText}` };
  } catch (err) {
    console.error("[EmailDispatcher] Microsoft Graph Delivery Error:", err);
    return { success: false, error: (err as Error).message };
  }
}

const globalEmailDedupeCache = new Map<string, number>();

export async function sendEodEmail(
  options: SendEmailOptions,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { to, subject } = options;

  if (!to || to.length === 0) {
    return { success: false, error: "No recipient emails specified" };
  }

  // Global Deduplication Guard: Suppress duplicate emails with identical recipients & subject within 30 seconds
  const dedupeKey = `${to.slice().sort().join(",")}_${subject}`;
  const now = Date.now();
  const lastSentTime = globalEmailDedupeCache.get(dedupeKey);
  if (lastSentTime && now - lastSentTime < 30000) {
    console.log(`[EmailDispatcher] Suppressing duplicate email send within 30s: ${dedupeKey}`);
    return { success: true, messageId: `suppressed-duplicate-${Date.now()}` };
  }
  globalEmailDedupeCache.set(dedupeKey, now);

  // 1. Try Microsoft Graph API if configured (Azure AD / Office 365 OAuth2 Client Credentials)
  const msTenantId = process.env.MS_TENANT_ID;
  const msClientId = process.env.MS_CLIENT_ID;
  const msClientSecret = process.env.MS_CLIENT_SECRET;
  const msSenderEmail = process.env.MS_SENDER_EMAIL || process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1];

  if (msTenantId && msClientId && msClientSecret && msSenderEmail) {
    return await sendViaMicrosoftGraph(
      options,
      msTenantId,
      msClientId,
      msClientSecret,
      msSenderEmail,
    );
  }

  // 2. Try SMTP if configured (Gmail / Google Workspace / Custom SMTP) — allows sending to ANY recipient email!
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

  // 3. Fallback to Resend API
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
    error: "No email provider (Microsoft Graph API, SMTP, or RESEND_API_KEY) configured in .env file.",
  };
}
