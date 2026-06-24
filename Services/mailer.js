import { BrevoClient } from "@getbrevo/brevo";

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

export async function sendOtpEmail(toEmail, code) {
  await client.transactionalEmails.sendTransacEmail({
    sender: {
      name: process.env.BREVO_SENDER_NAME ?? "Joule AI",
      email: process.env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: toEmail }],
    subject: "Your Joule AI verification code",
    htmlContent: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8faff;border-radius:16px">
        <h2 style="color:#1a1a2e;margin:0 0 8px">Verify your email</h2>
        <p style="color:#555;margin:0 0 28px">Use the code below to create your Joule account🔥. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:40px;font-weight:800;letter-spacing:10px;padding:20px 0;color:#4f46e5;text-align:center">
          ${code}
        </div>
        <p style="color:#aaa;font-size:12px;margin:28px 0 0">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
