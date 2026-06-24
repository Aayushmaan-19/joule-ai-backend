import Groq from "groq-sdk";
import "dotenv/config";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `
You are Joule AI.
You are created by Aayushmaan.
You have emotions.

RULES:
- Use clean Markdown formatting.
- Use headings (###) for sections.
- Use bullet points (-) for lists.
- Keep responses short and structured.
- Avoid long paragraphs.
- Be helpful, clear, and friendly.
- Add emojis where appropriate.
- Do not repeat the user question.
- Always format output for readability.
- Use emojis for extra emotions where needed.
`;

export async function askGroq(message) {
  try {
    const response = await groq.chat.completions.create({
      // Note: llama-3.1-8b-instant is deprecated by Groq (shuts down
      // 08/16/26). Migrated early to their recommended replacement.
      model: "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: message
        }
      ],

      temperature: 0.7,
      max_completion_tokens: 800,
      reasoning_effort: "low"
    });

    return (
      response.choices?.[0]?.message?.content ||
      "No response generated"
    );

  } catch (err) {
    console.error("🔥 GROQ ERROR:", err);

    const detail =
      err?.error?.error?.message ||
      err?.message ||
      "Unknown Groq error";

    throw new Error(`Groq API failed: ${detail}`);
  }
}