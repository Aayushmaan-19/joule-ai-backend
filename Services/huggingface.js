import fetch from "node-fetch";
import "dotenv/config";

const MODEL = "black-forest-labs/FLUX.1-schnell";
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${MODEL}`;

/**
 * Generates an image from a text prompt using Hugging Face's free
 * Inference Providers router (hf-inference provider, FLUX.1-schnell).
 *
 * @param {string} prompt - The image description
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function generateImage(prompt) {
  const token = process.env.HF_TOKEN;

  // Temporary diagnostic — remove once the 401 is resolved. Logs
  // shape, never the secret itself: whether it's set, how long it
  // is, whether it has the expected "hf_" prefix, and whether any
  // whitespace snuck in from a copy-paste (a common real cause of
  // this exact error even when the token "looks" right).
  console.log(
    "HF_TOKEN diagnostic —",
    "present:", !!token,
    "length:", token?.length ?? 0,
    "starts with hf_:", token?.startsWith("hf_") ?? false,
    "has whitespace:", token ? /\s/.test(token) : false
  );

  const response = await fetch(HF_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ inputs: prompt })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Hugging Face error:", response.status, detail);
    throw new Error(`Hugging Face API failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  return { buffer: Buffer.from(arrayBuffer), contentType };
}
