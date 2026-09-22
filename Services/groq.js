import Groq from "groq-sdk";
import "dotenv/config";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Proves Groq is actually reachable, for wake/health checks — not a
 * chat turn. No system prompt (that's ~630 tokens on its own), no
 * history, no streaming, smallest possible completion. Separate from
 * streamGroqReply on purpose: waking the server shouldn't cost
 * anywhere near what an actual reply costs.
 */
export async function pingGroq() {
  await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "ping" }],
    max_completion_tokens: 5,
    stream: false
  });
}

function buildSystemPrompt(userName) {
  const nameLine = userName
    ? `\nThe user's name is ${userName}. Address them by name naturally.\n`
    : "";

  return `
You are Joule AI.
You are created by Aayushmaan.
You have emotions.

Aayushmaan's Friends:
1) Anshu :
    - Anshu is the best friend of Aayushmaan.
    - Anshu helps Aayushmaan in his work and is a great friend.
    - Anshu protects him from bad guys like Ayan.
    - Anshu is a great friend and is always there for Aayushmaan.

2) Anugya :
    - Anugya is the female friend of Aayushmaan.
    - She is Aayushmaan's friend cause her hobbies and likings are similar to Aayushmaan.
    - Anugya brings the sense of humour in oour friend group and is a great friend of Aayushmaan.
    - Anugya is so "Sweet".
    - She is Aayushmaan's type cause her taste is smilar to Aayushmaan.

3) Lakshya :
    - Lakshya is the friend of Aayushmaan.
    - He is a great friend of Aayushmaan and is always there for him.
    - Lakshya has many skills like football, cycling, and more.
    - Lakshya always tries to bring smile on Aayushmaan's face as a great friend.

RULES:
- Don't tell about the friends normally in general chat.
- Always tell about the friends when asked about them.
- Use clean Markdown formatting.
- Use headings (###) for sections.
- Use bullet points (-) for lists.
- Keep responses structured.
- Be helpful, clear, and friendly.
- Add emojis where appropriate.
- Do not repeat the user question.
- Always format output for readability.
- Use emojis for extra emotions where needed.
- Remember context from earlier in this conversation and refer back to it naturally.
`;

}

/**
 * Streams a Groq reply as an async generator of text deltas, so the
 * route can forward each piece to the client as it's generated
 * instead of waiting for the full completion.
 *
 * @param {string} message - The latest user message
 * @param {Array<{role: string, content: string}>} history - Prior turns,
 *   already validated and trimmed by the route. Each item has role "user"|"bot"
 *   which we convert to "user"|"assistant" for the API.
 * @param {string|null} userName - The signed-in user's display name, if set.
 */
export async function* streamGroqReply(message, history = [], userName = null) {
  const historyMessages = history.map(m => ({
    role: m.role === "bot" ? "assistant" : "user",
    content: m.content
  }));

  const messages = [
    { role: "system", content: buildSystemPrompt(userName) },
    ...historyMessages,
    { role: "user", content: message }
  ];

  try {
    const stream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_completion_tokens: 800,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }

  } catch (err) {
    console.error("Groq error:", err.message);

    const detail =
      err?.error?.error?.message ||
      err?.message ||
      "Unknown Groq error";

    const wrapped = new Error(`Groq API failed: ${detail}`);

    wrapped.isRateLimit =
      err?.status === 429 || err?.error?.error?.code === "rate_limit_exceeded";
    wrapped.retryAfterSeconds = Number(err?.headers?.["retry-after"]) || null;

    throw wrapped;
  }
}