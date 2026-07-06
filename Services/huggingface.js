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
  const response = await fetch(HF_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
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
