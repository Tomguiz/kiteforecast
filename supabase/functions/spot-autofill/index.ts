// Fetches a kitespot website URL, extracts text, sends to Claude Haiku
// to extract structured spot data, returns JSON for form pre-fill.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SYSTEM_PROMPT = `You are a data extraction assistant. The user will give you HTML or text from a kitesurf spot or kite school website.
Extract the following fields and return ONLY valid JSON — no explanation, no markdown, just the JSON object:
{
  "name":    "Spot or school name (string or null)",
  "city":    "City or region (string or null)",
  "country": "Country (string or null)",
  "lat":     "Latitude as number or null",
  "lon":     "Longitude as number or null",
  "dirs":    "Good wind directions as comma-separated string e.g. SW, W, NW (string or null)",
  "business":"Business or school name if different from spot name (string or null)",
  "webcam":  "Webcam URL if found (string or null)"
}
If you cannot find a field, use null. For coordinates, look in Google Maps embeds, schema.org, meta tags, or address text. Do not invent data.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  let url: string
  try {
    const body = await req.json()
    url = body.url?.trim()
    if (!url) throw new Error('missing url')
  } catch {
    return new Response(JSON.stringify({ error: 'Provide { url }' }), { status: 400, headers: CORS })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS })
  }

  // 1. Fetch the website HTML
  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KiteForecastBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    return new Response(JSON.stringify({ error: `Could not fetch URL: ${e.message}` }), { status: 422, headers: CORS })
  }

  // 2. Strip HTML to reduce token count — keep text, meta, structured data
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000) // keep under ~3k tokens

  // 3. Call Claude Haiku
  let extracted: Record<string, string | number | null>
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `URL: ${url}\n\nPage content:\n${stripped}` }],
      }),
    })
    const aiJson = await aiRes.json()
    const text = aiJson.content?.[0]?.text ?? ''
    // Extract JSON from response (sometimes wrapped in ```json)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in response')
    extracted = JSON.parse(match[0])
  } catch (e) {
    return new Response(JSON.stringify({ error: `AI extraction failed: ${e.message}` }), { status: 500, headers: CORS })
  }

  return new Response(JSON.stringify({ ok: true, data: extracted }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
