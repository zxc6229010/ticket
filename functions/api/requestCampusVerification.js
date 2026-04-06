import { Resend } from "resend";

export async function onRequestPost({ request, env }) {
  try {
    const { schoolEmail, studentCode } = await request.json();

    const resend = new Resend(env.RESEND_API_KEY);

    const token = Math.random().toString(36).slice(2);

    const verifyUrl = `https://ticket.kmshteam.org/campus-verify.html?token=${token}`;

    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: schoolEmail,
      subject: "校園驗證信",
      html: `
        <h2>校園驗證</h2>
        <p>學號：${studentCode || "-"}</p>
        <a href="${verifyUrl}">點我驗證</a>
      `
    });

    return Response.json({ ok: true });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}