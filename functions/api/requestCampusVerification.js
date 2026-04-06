export async function onRequestPost(context) {
  return new Response(
    JSON.stringify({ ok: true, message: "API works ✅" }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}