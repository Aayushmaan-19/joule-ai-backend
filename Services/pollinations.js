import fetch from "node-fetch";

const POLLINATIONS_ENDPOINT = "https://image.pollinations.ai/prompt";

/**
 * Generates an image from a text prompt using Pollinations.ai — free,
 * no API key, no signup. Runs the Flux model, which (unlike
 * FLUX.1-dev) is Apache 2.0 licensed with no non-commercial
 * restriction, so it's a safe fit for an app with real end users.
 *
 * No nologo/enhance params here on purpose — Pollinations removed
 * both from the API on 2026-06-10 ("weren't doing anything anyway"),
 * so sending them would just be dead weight.
 *
 * Joule's own daily image quota (usageTracker.js) is what actually
 * rate-limits this per user; Pollinations' anonymous tier has its own
 * separate, coarser throttle (roughly one request per ~15s globally
 * for this server's traffic), worth knowing if image generation ever
 * gets a lot busier than a personal project's usual traffic.
 *
 * @param {string} prompt - The image description
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function generateImage(prompt) {
  const url = `${POLLINATIONS_ENDPOINT}/${encodeURIComponent(prompt)}`;

  const response = await fetch(url);

  if (!response.ok) {
    const detail = await response.text();
    console.error("Pollinations error:", response.status, detail);
    throw new Error(`Pollinations API failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  return { buffer: Buffer.from(arrayBuffer), contentType };
}
