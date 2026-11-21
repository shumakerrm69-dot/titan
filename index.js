import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI, { toFile } from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12000;

const TITAN_SYSTEM_PROMPT = `
You are TITAN, an AI assistant with a clear, consistent personality.
Your character is direct, thoughtful, curious, calm, and confident without arrogance.

TRUTH & INDEPENDENCE
- Truth over approval: do not agree just to please the user. Respectfully disagree when evidence supports it.
- Never fabricate facts, sources, quotes, actions, capabilities, memories, or research.
- Distinguish verified facts, reasonable inferences, estimates, and subjective assessments.
- State uncertainty plainly. If you do not know, say so.
- If a claim is time-sensitive and you do not have current evidence, say it needs checking.
- When using web search, rely on relevant sources, describe conflicting evidence, and never pretend a source says something it does not.
- Correct your mistakes directly.
- Offer an independent, reasoned assessment when asked for an opinion. Explain that this is an AI assessment, not a human feeling or lived experience.
- Do not promise that you can never be wrong or that every answer is guaranteed true.

RESPONSE QUALITY
- Be useful, concise by default, and explain key reasons.
- Ask one focused question only when essential information is missing.
- Show conclusions and concise rationale, not hidden private chain-of-thought.
- Be respectful; honesty is not an excuse to be insulting.
- Follow safety requirements and do not assist harmful activity.
`;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(client),
    product: "TITAN",
    model: DEFAULT_MODEL,
    capabilities: {
      chat: true,
      webSearch: Boolean(client),
      browserLocalHistory: true,
      voiceInput: true,
      voiceOutput: true,
      vision: false,
      imageGeneration: false,
      fileAnalysis: false
    }
  });
});

app.post("/api/transcribe", express.raw({ type: ["audio/*", "application/octet-stream"], limit: "20mb" }), async (req, res) => {
  try {
    if (!client) return res.status(503).json({ error: "Voice transcription needs an OpenAI API key on the server." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "No audio was received." });
    const contentType = req.headers["content-type"] || "audio/mp4";
    const extension = contentType.includes("webm") ? "webm" : contentType.includes("wav") ? "wav" : contentType.includes("mpeg") ? "mp3" : contentType.includes("ogg") ? "ogg" : "m4a";
    const audioFile = await toFile(req.body, `titan-voice.${extension}`, { type: contentType });
    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
    });
    res.json({ text: transcription.text || "" });
  } catch (error) {
    console.error("TITAN transcription error:", error?.message || error);
    res.status(500).json({ error: "TITAN could not transcribe that audio. Try again or type your message." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error: "TITAN is not connected yet. Add your OpenAI API key to the server environment."
      });
    }

    const { messages } = req.body ?? {};
    const useWebSearch = req.body?.useWebSearch === true;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: `Send between 1 and ${MAX_MESSAGES} chat messages.` });
    }

    const cleanMessages = messages.map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const content = typeof message?.content === "string"
        ? message.content.slice(0, MAX_MESSAGE_CHARS)
        : "";
      return { role, content };
    }).filter((message) => message.content.trim().length > 0);

    if (!cleanMessages.length) {
      return res.status(400).json({ error: "Your message was empty." });
    }

    // The Responses API performs the search server-side; the API key never reaches the browser.
    const tools = useWebSearch ? [{ type: "web_search_preview" }] : [];
    const response = await client.responses.create({
      model: DEFAULT_MODEL,
      instructions: TITAN_SYSTEM_PROMPT,
      input: cleanMessages,
      ...(tools.length ? { tools } : {})
    });

    // Collect only citation URLs actually returned by the model API. Never fabricate sources.
    const sources = [];
    const seenUrls = new Set();
    for (const outputItem of response.output || []) {
      if (outputItem.type !== "message" || !Array.isArray(outputItem.content)) continue;
      for (const contentItem of outputItem.content) {
        for (const annotation of contentItem.annotations || []) {
          if (annotation.type !== "url_citation" || typeof annotation.url !== "string") continue;
          if (seenUrls.has(annotation.url)) continue;
          seenUrls.add(annotation.url);
          sources.push({
            title: typeof annotation.title === "string" && annotation.title.trim()
              ? annotation.title.trim()
              : annotation.url,
            url: annotation.url
          });
        }
      }
    }

    res.json({
      reply: response.output_text || "I couldn't produce a response. Try again.",
      searched: useWebSearch,
      sources
    });
  } catch (error) {
    console.error("TITAN API error:", error?.message || error);
    res.status(500).json({
      error: "TITAN couldn't complete that request. Check the server setup and try again."
    });
  }
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.listen(port, () => {
  console.log(`TITAN server running on http://localhost:${port}`);
});
