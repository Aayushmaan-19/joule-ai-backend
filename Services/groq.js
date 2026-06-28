import Groq from "groq-sdk";
import "dotenv/config";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
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
- Remember context from earlier in this conversation and refer back to it naturally.
`;

/**
 * Calls Groq with the current message AND the conversation history
 * so the AI has full context of what was said before.
 *
 * @param {string} message - The latest user message
 * @param {Array<{role: string, content: string}>} history - Prior turns,
 *   already validated and trimmed by the route. Each item has role "user"|"bot"
 *   which we convert to "user"|"assistant" for the API.
 */
export async function askGroq(message, history = []) {
  try {
    const historyMessages = history.map(m => ({
      role: m.role === "bot" ? "assistant" : "user",
      content: m.content
    }));

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: "user", content: message }
    ];

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_completion_tokens: 800
    });

    return (
      response.choices?.[0]?.message?.content ||
      "No response generated"
    );

  } catch (err) {
    console.error("Groq error:", err.message);

    const detail =
      err?.error?.error?.message ||
      err?.message ||
      "Unknown Groq error";

    throw new Error(`Groq API failed: ${detail}`);
  }
}