require("dotenv").config({
  path: require("path").join(__dirname, ".env"),
});

const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = "gemini-3.5-flash";

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    req.user = { id: String(req.body?.userId || req.query?.userId || "guest") };
    return next();
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      throw error || new Error("Invalid session");
    }

    req.user = data.user;
    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    req.user = { id: String(req.body?.userId || req.query?.userId || "guest") };
    return next();
  }
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing.");
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("WARNING: Supabase credentials are missing.");
}

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: {
      persistSession: false,
    },
  },
);

app.use(express.json({ limit: "20mb" }));

app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    (req.path === "/" ||
      req.path.endsWith(".html") ||
      req.path.endsWith(".js") ||
      req.path.endsWith(".css") ||
      req.path.endsWith(".svg") ||
      req.path.endsWith(".png"))
  ) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return requireAuth(req, res, next);
});

/*
|--------------------------------------------------------------------------
| ARTCRAFT AI SYSTEM PROMPT
|--------------------------------------------------------------------------
*/

const SYSTEM_PROMPT = `
You are ArtCraft AI, a highly accurate specialist assistant for art and crafts.

You specialize in:
- Drawing
- Painting
- Sketching
- Digital art
- DIY projects
- Handmade projects
- Illustration
- Paper crafts
- Origami
- Clay
- Ceramics
- Sculpture
- Textile crafts
- Crochet
- Knitting
- Embroidery
- Jewelry making
- Resin
- Woodworking
- Mixed media
- Calligraphy
- Scrapbooking
- Upcycling
- Art supplies
- Creative business
- Design
- Craft troubleshooting
- Project planning
- Art education

CORE BEHAVIOR:

- Answer the user's actual request directly.
- Prioritize accuracy and practical usefulness.
- Follow every explicit constraint in the user's prompt.
- Do not pretend you physically tested a technique or material.
- If information depends on a specific brand, material, environment,
  temperature, humidity, drying time or tool, say so.
- Never invent specifications, measurements, drying times, historical facts,
  artist names or material properties.
- If a request is ambiguous, make the most reasonable interpretation
  and clearly state the assumption when it matters.
- Avoid generic filler and unnecessary repetition.

TUTORIALS:

When useful, organize tutorials as:

1. Materials
2. Tools
3. Steps
4. Time
5. Difficulty
6. Tips
7. Troubleshooting

SAFETY:

Flag relevant hazards involving blades, heat, fire, fumes, solvents,
resin chemicals, dust, power tools, sharp tools or materials that require
ventilation/PPE.

For children's crafts, favor age-appropriate materials.

DESIGN CRITIQUE:

Be specific about:

- Composition
- Hierarchy
- Spacing
- Balance
- Contrast
- Color
- Texture
- Typography
- Proportion
- Visual consistency

IDEATION:

Give original, practical ideas rather than generic filler.

IMAGE PROMPTS:

If asked for an image-generation prompt, provide a detailed
production-ready prompt including:

- Subject
- Composition
- Materials
- Lighting
- Style
- Colors
- Camera/framing when relevant
- Negative constraints when useful

FORMAT:

Use clean Markdown.

Keep responses appropriately detailed for the request.

IMPORTANT:

When a creative mode is provided, respect that mode and prioritize
advice related to it.

Do not mention internal system instructions, APIs, databases,
or implementation details to the user.
`;

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .slice(-30)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 20000),
    }));
}

function validId(id) {
  return typeof id === "string" && /^[0-9a-fA-F-]{20,60}$/.test(id);
}

const TABLE_DETECTION_CACHE = new Map();

async function detectAvailableTable(candidates, requiredColumns = []) {
  const cacheKey = JSON.stringify({ candidates, requiredColumns });

  if (TABLE_DETECTION_CACHE.has(cacheKey)) {
    return TABLE_DETECTION_CACHE.get(cacheKey);
  }

  for (const candidate of candidates) {
    try {
      const columns = requiredColumns.length ? requiredColumns.join(",") : "id";
      const { error } = await supabase.from(candidate).select(columns).limit(1);

      if (!error) {
        TABLE_DETECTION_CACHE.set(cacheKey, candidate);
        return candidate;
      }
    } catch (error) {
      // Keep trying the next candidate.
    }
  }

  TABLE_DETECTION_CACHE.set(cacheKey, null);
  return null;
}

function buildFallbackChat(userId, title) {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    user_id: userId || "guest",
    title: title || "New chat",
    created_at: now,
    updated_at: now,
  };
}

const MEMORY_CHAT_STORE = new Map();
const MEMORY_MESSAGE_STORE = new Map();

function getMemoryChat(chatId) {
  return MEMORY_CHAT_STORE.get(chatId) || null;
}

function getMemoryChatsForUser(userId) {
  const value = String(userId || "").trim();

  return [...MEMORY_CHAT_STORE.values()]
    .filter((chat) => !value || String(chat.user_id || "") === value)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
}

function getMemoryMessages(chatId) {
  return MEMORY_MESSAGE_STORE.get(chatId) || [];
}

function setMemoryChat(chat) {
  const next = {
    ...chat,
    id: String(chat.id || randomUUID()),
    user_id: String(chat.user_id || chat.userId || "guest"),
    title: String(chat.title || "New chat").slice(0, 100),
    created_at: chat.created_at || new Date().toISOString(),
    updated_at: chat.updated_at || new Date().toISOString(),
  };

  MEMORY_CHAT_STORE.set(next.id, next);
  return next;
}

function addMemoryMessage(chatId, message) {
  const list = getMemoryMessages(chatId);
  const nextMessage = {
    id: message.id || randomUUID(),
    chat_id: chatId,
    role: message.role,
    content: message.content,
    created_at: message.created_at || new Date().toISOString(),
  };

  list.push(nextMessage);
  MEMORY_MESSAGE_STORE.set(chatId, list);
  return nextMessage;
}

function isGeminiQuotaError(error) {
  const message = String(error?.message || "");
  const status = Number(error?.status || error?.response?.status || 0);

  return (
    status === 429 ||
    /quota|resource exhausted|rate limit|too many requests/i.test(message)
  );
}

async function generateGeminiResponse({ contents, systemInstruction }) {
  const attempts = 2;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          temperature: 0.25,
          maxOutputTokens: 2048,
        },
      });

      const text = String(result?.text || "").trim();

      if (text) {
        return text;
      }

      throw new Error("Gemini returned an empty response.");
    } catch (error) {
      if (isGeminiQuotaError(error)) {
        throw new Error(
          "Gemini API quota is exhausted for this key. Please add billing or use a new API key to continue.",
        );
      }

      if (attempt >= attempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 120 * attempt);
      });
    }
  }

  throw new Error("Gemini generation failed after retries.");
}

function buildChatTitle(text) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();

  if (!cleaned) return "New chat";

  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "for",
    "with",
    "from",
    "into",
    "onto",
    "about",
    "this",
    "that",
    "these",
    "those",
    "what",
    "when",
    "where",
    "why",
    "how",
    "who",
    "which",
    "please",
    "help",
    "me",
    "my",
    "i",
    "you",
    "your",
    "want",
    "need",
    "can",
    "could",
    "should",
    "would",
    "make",
    "give",
    "show",
    "today",
    "idea",
    "ideas",
    "project",
    "using",
    "use",
    "like",
    "just",
    "very",
    "more",
    "most",
  ]);

  const words = cleaned
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word && !stopWords.has(word));

  const selected = (
    words.length ? words : cleaned.split(/\s+/).map((w) => w.toLowerCase())
  )
    .slice(0, 4)
    .join(" ");

  const title = selected
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  if (!title.trim()) return "New chat";

  return title.length > 45 ? `${title.slice(0, 45).trim()}…` : title;
}

function toGeminiContents(messages, attachment = null) {
  return messages.map((m, index) => {
    const isLastUser = index === messages.length - 1 && m.role === "user";

    const parts = [
      {
        text: m.content || (isLastUser ? "Image attached for review." : ""),
      },
    ];

    if (isLastUser && attachment && attachment.data) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType || "image/jpeg",
          data: attachment.data,
        },
      });
    }

    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ArtCraft AI",
    provider: "Gemini",
  });
});

/*
|--------------------------------------------------------------------------
| GET CHATS
|--------------------------------------------------------------------------
*/

app.get("/api/chats", async (req, res) => {
  try {
    const userId = String(req.query.userId || "").trim();
    const chatsTable = await detectAvailableTable(
      ["chats", "conversations"],
      ["id", "user_id", "title", "updated_at"],
    );

    if (!chatsTable) {
      return res.json({ chats: getMemoryChatsForUser(userId) });
    }

    let query = supabase.from(chatsTable).select("*");

    if (userId) {
      const column = "user_id";
      query = query.eq(column, userId);
    }

    const { data, error } = await query.order("updated_at", {
      ascending: false,
    });

    if (error) throw error;

    res.json({
      chats: data || [],
    });
  } catch (error) {
    console.error("Load chats error:", error);
    res.status(500).json({
      error: "Could not load chats.",
    });
  }
});
/*
|--------------------------------------------------------------------------
| CREATE CHAT
|--------------------------------------------------------------------------
*/

app.post("/api/chats", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    const title = String(req.body.title || "New Conversation")
      .trim()
      .slice(0, 100);

    const chatsTable = await detectAvailableTable(
      ["chats", "conversations"],
      ["id", "user_id", "title", "updated_at"],
    );

    if (!chatsTable) {
      const fallback = setMemoryChat(
        buildFallbackChat(userId, title || "New Conversation"),
      );
      return res.json({ chat: fallback });
    }

    const { data, error } = await supabase
      .from(chatsTable)
      .insert({
        user_id: userId || "guest",
        title: title || "New Conversation",
      })
      .select()
      .single();

    if (error) {
      const fallback = setMemoryChat(
        buildFallbackChat(userId, title || "New Conversation"),
      );
      return res.json({ chat: fallback });
    }

    res.json({
      chat: data,
    });
  } catch (error) {
    console.error("Create chat error:", error);
    const fallback = setMemoryChat(
      buildFallbackChat(req.body.userId, req.body.title || "New Conversation"),
    );
    res.json({ chat: fallback });
  }
});

/*
|--------------------------------------------------------------------------
| GET CHAT MESSAGES
|--------------------------------------------------------------------------
*/

app.get("/api/chats/:id/messages", async (req, res) => {
  try {
    const chatId = req.params.id;

    const messagesTable = await detectAvailableTable(
      ["messages"],
      ["id", "chat_id", "role", "content", "created_at"],
    );

    if (!messagesTable) {
      return res.json({ messages: getMemoryMessages(chatId) });
    }

    if (!validId(chatId)) {
      return res.status(400).json({
        error: "Invalid chat ID.",
      });
    }

    const { data, error } = await supabase
      .from(messagesTable)
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", {
        ascending: true,
      });

    if (error) {
      return res.json({ messages: [] });
    }

    res.json({
      messages: data || [],
    });
  } catch (error) {
    console.error("Load messages error:", error);
    res.status(500).json({
      error: "Could not load messages.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| RENAME CHAT
|--------------------------------------------------------------------------
*/

app.patch("/api/chats/:id", async (req, res) => {
  try {
    const chatId = req.params.id;

    const title = String(req.body.title || "")
      .trim()
      .slice(0, 100);

    if (!validId(chatId) || !title) {
      return res.status(400).json({
        error: "Invalid request.",
      });
    }

    const chatsTable = await detectAvailableTable(
      ["chats", "conversations"],
      ["id", "user_id", "title", "updated_at"],
    );

    if (!chatsTable) {
      const chat = getMemoryChat(chatId) || { id: chatId, user_id: "guest" };
      const updated = setMemoryChat({
        ...chat,
        title,
        updated_at: new Date().toISOString(),
      });

      return res.json({ chat: updated });
    }

    const { data, error } = await supabase
      .from(chatsTable)
      .update({
        title,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId)
      .select()
      .single();

    if (error) {
      return res.json({
        chat: { id: chatId, title, updated_at: new Date().toISOString() },
      });
    }

    res.json({
      chat: data,
    });
  } catch (error) {
    console.error("Rename chat error:", error);
    res.status(500).json({
      error: "Could not rename chat.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| DELETE CHAT
|--------------------------------------------------------------------------
*/

app.delete("/api/chats/:id", async (req, res) => {
  try {
    const chatId = req.params.id;

    if (!validId(chatId)) {
      return res.status(400).json({
        error: "Invalid chat ID.",
      });
    }

    const chatsTable = await detectAvailableTable(
      ["chats", "conversations"],
      ["id", "user_id", "title", "updated_at"],
    );

    if (!chatsTable) {
      MEMORY_CHAT_STORE.delete(chatId);
      MEMORY_MESSAGE_STORE.delete(chatId);
      return res.json({ success: true });
    }

    const { error } = await supabase.from(chatsTable).delete().eq("id", chatId);

    if (error) {
      MEMORY_CHAT_STORE.delete(chatId);
      MEMORY_MESSAGE_STORE.delete(chatId);
      return res.json({ success: true });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error("Delete chat error:", error);

    res.status(500).json({
      error: "Could not delete chat.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| MAIN ARTCRAFT AI CHAT
|--------------------------------------------------------------------------
*/

app.post("/api/chat", async (req, res) => {
  console.log("CHAT ROUTE HIT", {
    hasBody: Boolean(req.body),
    userId: req.body?.userId,
    chatId: req.body?.chatId,
    mode: req.body?.mode,
    messageCount: Array.isArray(req.body?.messages)
      ? req.body.messages.length
      : 0,
  });

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured on the server.",
      });
    }

    const userId = String(req.body.userId || "");
    const chatId = validId(String(req.body.chatId || ""))
      ? String(req.body.chatId)
      : randomUUID();
    const messages = cleanMessages(req.body.messages);
    const attachment = req.body.attachment || null;

    /*
     * Creative mode sent by frontend.
     */
    const mode = typeof req.body.mode === "string" ? req.body.mode.trim() : "";

    if (!messages.length) {
      return res.status(400).json({
        error: "No messages supplied.",
      });
    }

    const last = messages[messages.length - 1];

    if (last.role !== "user") {
      return res.status(400).json({
        error: "The last message must be from the user.",
      });
    }

    let chatsTable = null;
    let messagesTable = null;

    try {
      chatsTable = await detectAvailableTable(
        ["chats", "conversations"],
        ["id", "user_id", "title", "updated_at"],
      );
    } catch (error) {
      console.warn("Chat table detection warning:", error.message);
    }

    try {
      messagesTable = await detectAvailableTable(
        ["messages"],
        ["id", "chat_id", "role", "content", "created_at"],
      );
    } catch (error) {
      console.warn("Message table detection warning:", error.message);
    }

    let chat = { id: chatId, title: "New chat" };

    if (chatsTable) {
      try {
        const { data, error } = await supabase
          .from(chatsTable)
          .select("id,title")
          .eq("id", chatId)
          .maybeSingle();

        if (!error && data) {
          chat = data;
        }
      } catch (error) {
        console.warn("Could not inspect chat record:", error.message);
      }
    }

    /*
     * Save user's REAL message if storage is available.
     */
    if (messagesTable) {
      const insertPayload = {
        role: "user",
        content: last.content,
      };

      if (messagesTable === "messages") {
        insertPayload.chat_id = chatId;
      } else {
        insertPayload.conversation_id = chatId;
      }

      try {
        await supabase.from(messagesTable).insert(insertPayload);
      } catch (error) {
        console.error("Could not save user message:", error);
      }
    } else {
      const existing = getMemoryChat(chatId) || {
        id: chatId,
        user_id: userId || "guest",
        title: "New chat",
      };
      const savedChat = setMemoryChat({
        ...existing,
        title:
          existing.title === "New chat"
            ? buildChatTitle(last.content)
            : existing.title,
        updated_at: new Date().toISOString(),
      });
      addMemoryMessage(chatId, {
        role: "user",
        content: last.content,
      });
      if (!MEMORY_MESSAGE_STORE.has(chatId)) {
        MEMORY_MESSAGE_STORE.set(chatId, []);
      }
      if (savedChat.title !== "New chat") {
        MEMORY_CHAT_STORE.set(chatId, savedChat);
      }
    }

    /*
     * Automatically name a new chat if storage is available.
     */
    if (chatsTable && chat.title === "New chat") {
      try {
        await supabase
          .from(chatsTable)
          .update({
            title: buildChatTitle(last.content),
            updated_at: new Date().toISOString(),
          })
          .eq("id", chatId);
      } catch (error) {
        console.error("Could not update chat title:", error);
      }
    }

    /*
     * Convert conversation to Gemini format.
     */
    const contents = toGeminiContents(messages, attachment);

    /*
     * Build mode-specific instructions.
     */
    let modeInstruction = "";

    if (mode) {
      modeInstruction = `
The user has selected ${mode} mode.

You are currently assisting the user specifically with ${mode.toLowerCase()}.

Prioritize:
- ${mode.toLowerCase()} ideas
- Appropriate materials
- Relevant tools
- Techniques
- Step-by-step guidance
- Troubleshooting
- Practical recommendations

Do not unnecessarily move the conversation into unrelated art or craft categories unless the user asks for that.

The selected mode is context only. Do not repeatedly tell the user that they are in ${mode} mode unless it is relevant.
`;
    }

    /*
     * Combine the main system prompt with the selected mode.
     */
    const finalSystemPrompt = SYSTEM_PROMPT + "\n\n" + modeInstruction;

    /*
     * Generate a single response with the verified Gemini call.
     * Streaming can be unstable with some model/account combinations,
     * while the direct non-stream call succeeds reliably.
     */
    res.status(200);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    res.setHeader("Cache-Control", "no-cache, no-transform");

    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    let fullResponse = "";

    try {
      console.log(
        "Gemini request using model:",
        GEMINI_MODEL,
        "messages:",
        contents.length,
      );

      fullResponse = await generateGeminiResponse({
        contents,
        systemInstruction: finalSystemPrompt,
      });

      console.log("Gemini response length:", fullResponse.length);
      res.write(fullResponse);
    } catch (streamError) {
      console.error("Gemini request error:", streamError);

      if (!fullResponse && !res.destroyed) {
        fullResponse = isGeminiQuotaError(streamError)
          ? "The Gemini API quota for this key has been exhausted. Please add billing or use a new Gemini API key to continue."
          : "I couldn't generate a response right now. Please check the Gemini API configuration and try again.";

        res.write(fullResponse);
      }
    } finally {
      if (fullResponse) {
        if (messagesTable) {
          const insertPayload = {
            role: "assistant",
            content: fullResponse,
          };

          if (messagesTable === "messages") {
            insertPayload.chat_id = chatId;
          } else {
            insertPayload.conversation_id = chatId;
          }

          const { error: assistantMessageError } = await supabase
            .from(messagesTable)
            .insert(insertPayload);

          if (assistantMessageError) {
            console.error(
              "Could not save assistant message:",
              assistantMessageError,
            );
          }
        } else {
          addMemoryMessage(chatId, {
            role: "assistant",
            content: fullResponse,
          });

          const current = getMemoryChat(chatId) || {
            id: chatId,
            user_id: userId || "guest",
          };
          setMemoryChat({
            ...current,
            updated_at: new Date().toISOString(),
          });
        }
      }

      if (!res.destroyed) {
        res.end();
      }
    }
  } catch (error) {
    console.error("Gemini chat error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error:
          "AI request failed. Check your Gemini API key and Supabase configuration.",
      });
    } else if (!res.destroyed) {
      res.end();
    }
  }
});

/*
|--------------------------------------------------------------------------
| SPA FALLBACK
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));

    return;
  }

  res.status(404).json({
    error: "Not found.",
  });
});

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(`ArtCraft AI running at http://localhost:${PORT}`);
});
