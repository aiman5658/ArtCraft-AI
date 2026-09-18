const supabaseConfig = window.__SUPABASE_CONFIG__ || {};
const hasSupabaseConfig = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
const supabase =
  window.supabase && hasSupabaseConfig
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

const state = {
  userId: localStorage.getItem("artcraft_user_id") || crypto.randomUUID(),
  activeChatId: null,
  activeMode: null,
  modeQuestion: null,
  chats: [],
  messages: [],
  generating: false,
  controller: null,
  listening: false,
  deleteTargetId: null,
  renameTargetId: null,
  authMode: "login",
  attachment: null,
};

localStorage.setItem("artcraft_user_id", state.userId);

const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const chatList = $("chatList");
const searchInput = $("searchInput");
const conversation = $("conversation");
const welcome = $("welcome");
const messagesEl = $("messages");
const input = $("messageInput");
const sendBtn = $("sendBtn");
const micBtn = $("micBtn");
const imageInput = $("imageInput");
const attachmentPreview = $("attachmentPreview");

if (!window.__artcraftAppBooted) {
  window.__artcraftAppBooted = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

function updateModeIndicator() {
  const indicator = $("modeIndicator");
  const label = $("modeIndicatorText");

  if (!indicator || !label) return;

  if (!state.activeMode) {
    indicator.classList.add("hidden");
    label.textContent = "";
    return;
  }

  indicator.classList.remove("hidden");
  label.textContent = `${state.activeMode} mode`;
}

function refreshAuthModeUI() {
  const submitBtn = $("authSubmit");
  const toggleBtn = $("authModeToggle");
  const title = $("authTitle");

  if (!submitBtn || !toggleBtn || !title) return;

  if (state.authMode === "login") {
    submitBtn.textContent = "Log in";
    toggleBtn.textContent = "Need an account? Sign up";
    title.textContent = "Log in to continue";
    return;
  }

  submitBtn.textContent = "Create account";
  toggleBtn.textContent = "Already have an account? Log in";
  title.textContent = "Create your account";
}

function setAuthStatus(message, isError = false) {
  const authStatus = $("authStatus");

  if (!authStatus) return;

  authStatus.textContent = message;
  authStatus.style.color = isError ? "var(--danger)" : "#0d7d61";
}

function showAuthScreen(message = "") {
  const authScreen = $("authScreen");
  const appShell = $("app");

  if (authScreen) authScreen.classList.remove("hidden");
  if (appShell) appShell.classList.add("hidden");

  if (message) setAuthStatus(message, true);
}

function hideAuthScreen() {
  const authScreen = $("authScreen");
  const appShell = $("app");

  if (authScreen) authScreen.classList.add("hidden");
  if (appShell) appShell.classList.remove("hidden");
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!supabase) {
    setAuthStatus(
      "Supabase is not configured yet. Add your anon key before deployment.",
      true,
    );
    return;
  }

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    setAuthStatus("Enter both email and password.", true);
    return;
  }

  try {
    if (state.authMode === "signup") {
      setAuthStatus("Creating account...");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.session) {
        state.userId = data.user.id;
        localStorage.setItem("artcraft_user_id", state.userId);
        hideAuthScreen();
        setAuthStatus("");
        await loadChats();
        return;
      }

      setAuthStatus(
        "Account created. Check your email to confirm, then log in.",
        false,
      );
      state.authMode = "login";
      refreshAuthModeUI();
      $("authPassword").value = "";
      return;
    }

    setAuthStatus("Logging in...");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    state.userId = data.user.id;
    localStorage.setItem("artcraft_user_id", state.userId);

    hideAuthScreen();
    setAuthStatus("");
    await loadChats();
  } catch (error) {
    console.error(error);
    setAuthStatus(
      error.message ||
        (state.authMode === "signup"
          ? "Could not create account."
          : "Could not log in."),
      true,
    );
  }
}

async function handleLogout() {
  if (!supabase) return;

  try {
    await supabase.auth.signOut();
    state.activeChatId = null;
    state.messages = [];
    state.chats = [];
    renderChatList();
    renderMessages();
    localStorage.setItem("artcraft_user_id", crypto.randomUUID());
    showAuthScreen("You are logged out.");
  } catch (error) {
    console.error(error);
    showToast("Could not log out.");
  }
}

async function handleForgotPassword() {
  const email = $("authEmail").value.trim();

  if (!email) {
    setAuthStatus("Enter your email first to reset the password.", true);
    $("authEmail").focus();
    return;
  }

  try {
    setAuthStatus("Sending reset link...");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    if (error) throw error;

    setAuthStatus("Password reset email sent.", false);
  } catch (error) {
    console.error(error);
    setAuthStatus(error.message || "Could not send reset email.", true);
  }
}

async function init() {
  refreshAuthModeUI();
  updateModeIndicator();

  $("authForm")?.addEventListener("submit", handleAuthSubmit);
  $("authModeToggle")?.addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    refreshAuthModeUI();
    setAuthStatus("");
    $("authPassword").value = "";
    $("authEmail").focus();
  });
  $("authForgotPassword")?.addEventListener("click", handleForgotPassword);
  $("passwordToggle")?.addEventListener("click", () => {
    const passwordInput = $("authPassword");
    const toggleButton = $("passwordToggle");

    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggleButton.textContent = isHidden ? "🙈" : "👁";
    toggleButton.setAttribute(
      "aria-label",
      isHidden ? "Hide password" : "Show password",
    );
  });
  $("logoutBtn")?.addEventListener("click", handleLogout);

  if (!supabase) {
    showAuthScreen(
      "Missing Supabase anon key. Add it to the page config before deploy.",
    );
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    showAuthScreen("Please log in to use ArtCraft AI.");
    return;
  }

  state.userId = session.user.id;
  localStorage.setItem("artcraft_user_id", state.userId);

  hideAuthScreen();

  $("newChatBtn").addEventListener("click", newChat);
  $("topNewChat").addEventListener("click", newChat);

  $("toggleSidebar").addEventListener("click", () => {
    sidebar.classList.toggle("closed");
  });

  $("closeSidebar").addEventListener("click", () => {
    sidebar.classList.add("closed");
  });

  $("attachBtn").addEventListener("click", () => {
    imageInput.click();
  });

  imageInput.addEventListener("change", handleAttachment);

  sendBtn.onclick = () => {
    if (state.generating) {
      stopGeneration();
      return;
    }

    sendMessage();
  };

  micBtn.addEventListener("click", toggleSpeechToText);

  input.addEventListener("input", autoResize);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  searchInput.addEventListener("input", renderChatList);

  /*
   * Creative category buttons
   */
  document.querySelectorAll(".craft-category").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.querySelector("span:last-child")?.textContent.trim();

      const modeQuestions = {
        Painting: "What do you want to paint today?",
        Sketching: "What do you want to sketch today?",
        Knitting: "What do you want to knit today?",
        Crafting: "What do you want to craft today?",
      };

      const question = modeQuestions[mode];

      if (!question) return;

      state.activeMode = mode;
      state.modeQuestion = question;

      state.activeChatId = null;
      state.messages = [];

      document.querySelectorAll(".craft-category").forEach((card) => {
        card.classList.remove("active");
      });

      btn.classList.add("active");
      updateModeIndicator();

      welcome.classList.add("hidden");
      messagesEl.classList.remove("hidden");

      renderMessages();
      input.focus();
    });
  });

  const deleteModal = $("deleteConfirmModal");
  const renameModal = $("renameModal");

  $("deleteConfirmCancel").addEventListener("click", closeDeleteModal);
  $("deleteConfirmConfirm").addEventListener("click", confirmDeleteChat);
  $("renameCancel").addEventListener("click", closeRenameModal);
  $("renameConfirm").addEventListener("click", confirmRenameChat);

  deleteModal.addEventListener("click", (event) => {
    if (event.target === deleteModal) closeDeleteModal();
  });

  renameModal.addEventListener("click", (event) => {
    if (event.target === renameModal) closeRenameModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (deleteModal.classList.contains("show")) {
        closeDeleteModal();
      }

      if (renameModal.classList.contains("show")) {
        closeRenameModal();
      }
    }
  });

  await loadChats();
  updateSendButton();
}

/* =========================================================
   API HELPER
========================================================= */

async function api(url, options = {}) {
  const session = supabase
    ? (await supabase.auth.getSession()).data.session
    : null;
  const authHeaders = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = res.headers.get("content-type") || "";

  const data = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

/* =========================================================
   LOAD CHATS
========================================================= */

async function loadChats() {
  try {
    const data = await api(
      `/api/chats?userId=${encodeURIComponent(state.userId)}`,
    );

    state.chats = data.chats || [];
    renderChatList();
  } catch (err) {
    console.error(err);
    showToast("Could not load chat history.");
  }
}

/* =========================================================
   CHAT LIST
========================================================= */

function renderChatList() {
  const query = searchInput.value.trim().toLowerCase();

  const chats = state.chats.filter((chat) =>
    String(chat.title || "")
      .toLowerCase()
      .includes(query),
  );

  if (!chats.length) {
    chatList.innerHTML = `
      <div class="empty-history">No chats yet.</div>
    `;
    return;
  }

  chatList.innerHTML = chats
    .map(
      (chat) => `
        <div
          class="chat-row ${chat.id === state.activeChatId ? "active" : ""}"
          data-id="${chat.id}"
        >
          <button class="chat-open" data-action="open">
            <span class="chat-icon">◌</span>
            <span class="chat-title">
              ${escapeHtml(chat.title || "New chat")}
            </span>
          </button>

          <div class="row-actions">
            <button
              data-action="rename"
              title="Rename"
            >
              ✎
            </button>

            <button
              data-action="delete"
              class="delete"
              title="Delete"
            >
              ×
            </button>
          </div>
        </div>
      `,
    )
    .join("");

  chatList.querySelectorAll(".chat-row").forEach((row) => {
    const id = row.dataset.id;

    row
      .querySelector('[data-action="open"]')
      .addEventListener("click", () => openChat(id));

    row
      .querySelector('[data-action="rename"]')
      .addEventListener("click", () => renameChat(id));

    row
      .querySelector('[data-action="delete"]')
      .addEventListener("click", () => deleteChat(id));
  });
}

/* =========================================================
   NEW CHAT
========================================================= */

async function newChat() {
  try {
    const data = await api("/api/chats", {
      method: "POST",
      body: JSON.stringify({
        userId: state.userId,
        title: "New chat",
      }),
    });

    state.chats.unshift(data.chat);

    state.activeChatId = data.chat.id;
    state.activeMode = null;
    state.modeQuestion = null;
    state.messages = [];

    updateModeIndicator();
    renderChatList();
    renderMessages();

    input.focus();

    if (window.innerWidth <= 760) {
      sidebar.classList.add("closed");
    }
  } catch (err) {
    console.error(err);
    showToast("Could not create a new chat.");
  }
}

/* =========================================================
   OPEN CHAT
========================================================= */

async function openChat(id) {
  try {
    state.activeChatId = id;
    state.activeMode = null;
    state.modeQuestion = null;

    const data = await api(`/api/chats/${id}/messages`);

    state.messages = data.messages || [];

    updateModeIndicator();
    renderChatList();
    renderMessages();

    if (window.innerWidth <= 760) {
      sidebar.classList.add("closed");
    }
  } catch (err) {
    console.error(err);
    showToast("Could not open this chat.");
  }
}

/* =========================================================
   DELETE CHAT
========================================================= */

async function deleteChat(id) {
  const chat = state.chats.find((c) => c.id === id);

  if (!chat) return;

  state.deleteTargetId = id;
  const modalTitle = $("deleteConfirmTitle");
  const modalText = $("deleteConfirmText");

  modalTitle.textContent = "Delete conversation?";
  modalText.textContent = `Delete "${chat.title}" permanently? This action cannot be undone.`;

  $("deleteConfirmModal").classList.add("show");
}

function closeDeleteModal() {
  $("deleteConfirmModal").classList.remove("show");
  state.deleteTargetId = null;
}

async function confirmDeleteChat() {
  const id = state.deleteTargetId;

  if (!id) return;

  closeDeleteModal();

  try {
    await api(`/api/chats/${id}`, {
      method: "DELETE",
    });

    state.chats = state.chats.filter((c) => c.id !== id);

    if (state.activeChatId === id) {
      state.activeChatId = null;
      state.activeMode = null;
      state.modeQuestion = null;
      state.messages = [];
    }

    updateModeIndicator();
    renderChatList();
    renderMessages();

    showToast("Chat deleted.");
  } catch (err) {
    console.error(err);
    showToast("Could not delete chat.");
  }
}

/* =========================================================
   RENAME CHAT
========================================================= */

function closeRenameModal() {
  $("renameModal").classList.remove("show");
  state.renameTargetId = null;
  $("renameInput").value = "";
}

async function renameChat(id) {
  const chat = state.chats.find((c) => c.id === id);

  if (!chat) return;

  state.renameTargetId = id;
  const renameInput = $("renameInput");
  renameInput.value = chat.title || "";

  $("renameModal").classList.add("show");

  requestAnimationFrame(() => {
    renameInput.focus();
    renameInput.select();
  });
}

async function confirmRenameChat() {
  const id = state.renameTargetId;
  const title = $("renameInput").value.trim();

  if (!id || !title) {
    $("renameInput").focus();
    return;
  }

  closeRenameModal();

  try {
    const data = await api(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title,
      }),
    });

    state.chats = state.chats.map((c) => (c.id === id ? data.chat : c));

    renderChatList();
  } catch (err) {
    console.error(err);
    showToast("Could not rename chat.");
  }
}

/* =========================================================
   RENDER MESSAGES
========================================================= */

function renderMessages() {
  const hasMessages = state.messages.length > 0;
  const hasModeQuestion = Boolean(state.modeQuestion);

  const shouldShowConversation = hasMessages || hasModeQuestion;

  welcome.classList.toggle("hidden", shouldShowConversation);

  messagesEl.classList.toggle("hidden", !shouldShowConversation);

  if (!shouldShowConversation) {
    messagesEl.innerHTML = "";
    return;
  }

  /*
   * Temporary mode question
   */
  const modeQuestionHTML = hasModeQuestion
    ? `
      <article class="message">
        <div class="avatar ai">
          ✦
        </div>

        <div class="message-content">
          <div class="message-name">
            ArtCraft AI
          </div>

          <div class="message-text">
            <p>${escapeHtml(state.modeQuestion)}</p>
          </div>
        </div>
      </article>
    `
    : "";

  /*
   * Actual messages
   */
  const messagesHTML = state.messages
    .map((message, index) => {
      const isAI = message.role === "assistant";

      const attachmentMarkup =
        !isAI && message.attachment?.data
          ? `
            <div class="message-attachment">
              <img
                src="data:${message.attachment.mimeType || "image/jpeg"};base64,${message.attachment.data}"
                alt="${escapeHtml(message.attachment.name || "Attached image")}"
                class="message-attachment-image"
              />
            </div>
          `
          : "";

      const body = isAI
        ? message.content
          ? marked.parse(message.content)
          : `<span class="typing">Thinking…</span>`
        : `
          ${attachmentMarkup}
          <p>${escapeHtml(message.content || "Image attachment")}</p>
        `;

      const actions =
        isAI && message.content
          ? `
            <div class="message-actions">
              <button data-copy="${index}">
                Copy
              </button>

              ${
                index === state.messages.length - 1
                  ? `
                    <button data-regenerate="${index}">
                      Regenerate
                    </button>
                  `
                  : ""
              }
            </div>
          `
          : "";

      return `
        <article class="message ${isAI ? "assistant" : "user"}">
          <div class="avatar ${isAI ? "ai" : "user"}">
            ${isAI ? "✦" : "A"}
          </div>

          <div class="message-content">
            <div class="message-name">
              ${isAI ? "ArtCraft AI" : "You"}
            </div>

            <div class="message-text">
              ${body}
            </div>

            ${actions}
          </div>
        </article>
      `;
    })
    .join("");

  messagesEl.innerHTML = modeQuestionHTML + messagesHTML;

  /*
   * Copy buttons
   */
  messagesEl.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.copy);

      navigator.clipboard.writeText(state.messages[index].content);

      showToast("Copied.");
    });
  });

  /*
   * Regenerate buttons
   */
  messagesEl.querySelectorAll("[data-regenerate]").forEach((btn) => {
    btn.addEventListener("click", regenerate);
  });

  conversation.scrollTop = conversation.scrollHeight;
}

/* =========================================================
   SEND MESSAGE
========================================================= */

async function readSelectedAttachment(file) {
  if (!file) return null;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const data = result.includes(",") ? result.split(",")[1] : result;

      resolve({
        name: file.name,
        mimeType: file.type || "image/jpeg",
        data,
        file,
      });
    };

    reader.onerror = () =>
      reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function sendMessage(presetText = null, presetAttachment = null) {
  if (state.generating) return;

  const text = (presetText ?? input.value).trim();
  const selectedFile = imageInput.files?.[0] || null;

  let attachment = state.attachment || presetAttachment || null;

  if (!attachment && selectedFile) {
    attachment = await readSelectedAttachment(selectedFile);
    state.attachment = attachment;
  }

  if (!attachment && !presetText) {
    const lastUser = [...state.messages]
      .reverse()
      .find((m) => m.role === "user");
    attachment = lastUser?.attachment || null;
  }

  if (!text && !attachment?.data) return;

  /*
   * Remove temporary category question
   */
  state.modeQuestion = null;

  let chatId = state.activeChatId;

  try {
    /*
     * Create chat when first real message is sent
     */
    if (!chatId) {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({
          userId: state.userId,
          title: buildChatTitle(text),
        }),
      });

      state.chats.unshift(data.chat);

      state.activeChatId = data.chat.id;
      chatId = data.chat.id;

      renderChatList();
    }

    /*
     * Add user message
     */
    const userMessage = {
      role: "user",
      content: text || "Image attachment",
      attachment: attachment
        ? {
            name: attachment.name,
            mimeType: attachment.mimeType,
            data: attachment.data,
          }
        : null,
    };

    state.messages.push(userMessage);

    input.value = "";

    autoResize();
    renderMessages();

    /*
     * Add empty AI message
     */
    const assistantMessage = {
      role: "assistant",
      content: "",
    };

    state.messages.push(assistantMessage);

    state.generating = true;

    updateSendButton();
    renderMessages();

    /*
     * Prepare chat history
     */
    const history = state.messages
      .slice(0, -1)
      .slice(-30)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    /*
     * Mode information
     */
    const modeInstruction = state.activeMode
      ? `
The user is currently using ${state.activeMode} mode.

Focus your response primarily on ${state.activeMode.toLowerCase()}
and closely related techniques, materials, tools, ideas,
methods, project guidance, and troubleshooting.

Stay relevant to this creative category unless the user's
request clearly asks for something outside it.
      `.trim()
      : "";

    /*
     * Send to Gemini backend
     */
    state.controller = new AbortController();

    const session = supabase
      ? (await supabase.auth.getSession()).data.session
      : null;

    const authHeaders = session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : {};

    const response = await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },

      body: JSON.stringify({
        userId: state.userId,
        chatId,
        messages: history,
        mode: state.activeMode,
        modeInstruction,
        attachment: attachment?.data
          ? {
              name: attachment.name,
              mimeType: attachment.mimeType,
              data: attachment.data,
            }
          : null,
      }),

      signal: state.controller.signal,
    });

    /*
     * Handle server error
     */
    if (!response.ok) {
      const raw = await response.text();
      let parsed = {};

      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch (error) {
        parsed = {};
      }

      throw new Error(parsed.error || raw || "AI request failed.");
    }

    /*
     * Streaming check
     */
    if (!response.body) {
      throw new Error("Streaming is not available.");
    }

    /*
     * Stream AI response
     */
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      assistantMessage.content += decoder.decode(value, {
        stream: true,
      });

      renderMessages();
    }

    /*
     * Refresh sidebar chat history
     */
    await loadChats();
  } catch (error) {
    console.error(error);

    if (error.name === "AbortError") {
      const last = state.messages.at(-1);

      if (last?.role === "assistant" && !last.content) {
        state.messages.pop();
      }

      renderMessages();
    } else {
      const last = state.messages.at(-1);

      if (last?.role === "assistant") {
        last.content = `Sorry, I couldn't complete that request.

**Error:** ${error.message}`;
      }

      renderMessages();
    }
  } finally {
    state.generating = false;
    state.controller = null;
    state.attachment = null;
    imageInput.value = "";
    attachmentPreview.classList.add("hidden");
    attachmentPreview.textContent = "";

    updateSendButton();
  }
}

/* =========================================================
   STOP GENERATION
========================================================= */

function stopGeneration() {
  state.controller?.abort();

  state.generating = false;

  updateSendButton();
}

/* =========================================================
   REGENERATE
========================================================= */

async function regenerate() {
  if (state.generating) return;

  const previous = state.messages.slice(0, -1);

  const lastUser = [...previous].reverse().find((m) => m.role === "user");

  if (!lastUser) return;

  state.messages = previous.slice(0, previous.lastIndexOf(lastUser) + 1);

  renderMessages();

  await sendMessage(lastUser.content, lastUser.attachment || null);
}

/* =========================================================
   SEND BUTTON
========================================================= */

function updateSendButton() {
  if (state.generating) {
    sendBtn.textContent = "■";
    sendBtn.title = "Stop";
    sendBtn.classList.add("stop");
    sendBtn.onclick = () => {
      stopGeneration();
    };
  } else {
    sendBtn.textContent = "➤";
    sendBtn.title = "Send";
    sendBtn.classList.remove("stop");
    sendBtn.onclick = () => {
      sendMessage();
    };
  }
}

/* =========================================================
   AUTO RESIZE
========================================================= */

function autoResize() {
  input.style.height = "auto";

  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

/* =========================================================
   SPEECH TO TEXT
========================================================= */

function toggleSpeechToText() {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    showToast("Speech-to-text is not supported here. Try Chrome or Edge.");

    return;
  }

  if (state.listening) return;

  const recognition = new Recognition();

  recognition.lang = navigator.language || "en-US";

  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    state.listening = true;

    micBtn.classList.add("listening");

    showToast("Listening…");
  };

  recognition.onresult = (event) => {
    let transcript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    input.value = transcript;

    autoResize();
  };

  recognition.onerror = () => {
    showToast("Microphone input could not be used.");
  };

  recognition.onend = () => {
    state.listening = false;

    micBtn.classList.remove("listening");
  };

  recognition.start();
}

/* =========================================================
   ATTACHMENT
========================================================= */

function handleAttachment() {
  const file = imageInput.files[0];

  if (!file) {
    state.attachment = null;
    attachmentPreview.classList.add("hidden");
    attachmentPreview.innerHTML = "";
    return;
  }

  const reader = new FileReader();

  reader.onloadend = () => {
    const result = typeof reader.result === "string" ? reader.result : "";

    state.attachment = {
      name: file.name,
      mimeType: file.type || "image/jpeg",
      data: result.includes(",") ? result.split(",")[1] : result,
      file,
    };

    const previewMarkup = `
      <img src="${result}" alt="${escapeHtml(file.name)}" class="attachment-thumb" />
      <span class="attachment-name">${escapeHtml(file.name)}</span>
    `;

    attachmentPreview.innerHTML = previewMarkup;
    attachmentPreview.classList.remove("hidden");
  };

  reader.readAsDataURL(file);
}

/* =========================================================
   TOAST
========================================================= */

function showToast(text) {
  const toast = $("toast");

  toast.textContent = text;

  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
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
    "theirs",
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

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
