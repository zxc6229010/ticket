export async function sendMail(env, { to, subject, html, text }) {
  const from = env.MAIL_FROM;
  if (!from) {
    throw new Error("Missing MAIL_FROM");
  }

  const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }]
        }
      ],
      from: {
        email: from.includes("<") ? from.match(/<([^>]+)>/)?.[1] || from : from,
        name: from.includes("<") ? from.split("<")[0].trim() : "Passium"
      },
      subject,
      content: [
        {
          type: "text/plain",
          value: text || ""
        },
        {
          type: "text/html",
          value: html || ""
        }
      ]
    })
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`寄信失敗: ${msg || resp.status}`);
  }
}