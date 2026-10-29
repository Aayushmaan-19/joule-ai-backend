import fetch from "node-fetch";

const POLLINATIONS_ENDPOINT = "https://gen.pollinations.ai/image";

/**
 * Generates an image from a text prompt using Pollinations' unified API
 * (gen.pollinations.ai) with a server-side secret key (sk_...).
 *
 * The old keyless endpoint (image.pollinations.ai) is capped at one
 * image per 45 seconds per IP — and every request from this backend
 * shares Render's outbound IP, so it answered 402 FREE_LIMIT as soon as
 * two users (or one user twice) generated within that window. A secret
 * key isn't subject to that per-IP limit; usage is billed against the
 * account's Pollen balance instead.
 *
 * Joule's own daily image quota (usageTracker.js) is what bounds how
 * much Pollen users can spend.
 *
 * The key must stay server-side — never send it to the browser.
 *
 * @param {string} prompt - The image description
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function generateImage(prompt) {
  const apiKey = process.env.POLLINATIONS_API_KEY;

  if (!apiKey) {
    throw new Error("POLLINATIONS_API_KEY is not set");
  }

  const url = `${POLLINATIONS_ENDPOINT}/${encodeURIComponent(prompt)}?model=flux`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Pollinations error:", response.status, detail);
    throw new Error(`Pollinations API failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  return { buffer: Buffer.from(arrayBuffer), contentType };
}
