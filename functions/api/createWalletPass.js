export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { barcode, fields } = body;

    if (!barcode || !fields) {
      return new Response(JSON.stringify({ error: "缺少必要參數" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const apiKey = env.PASS2U_API_KEY || "9f907c6b29d59059f53019f425f48655";
    const modelId = "376973";

    const resp = await fetch(`https://api.pass2u.net/v2/models/${modelId}/passes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({ barcode, fields })
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const errMsg = data.message || data.error || JSON.stringify(data);
      console.error("Pass2U error:", resp.status, errMsg);
      return new Response(JSON.stringify({ error: errMsg, raw: data }), {
        status: resp.status,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "伺服器錯誤" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}