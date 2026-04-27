const state = {
  me: {
    name: localStorage.getItem("pulseroom-name") || "",
    groupId: null
  },
  groups: [],
  users: [],
  messages: [],
  stream: null
};

const els = {
  profileSelect: document.querySelector("#profileSelect"),
  nameInput: document.querySelector("#nameInput"),
  roomSelect: document.querySelector("#roomSelect"),
  statusInput: document.querySelector("#statusInput"),
  newRoomBtn: document.querySelector("#newRoomBtn"),
  seedBtn: document.querySelector("#seedBtn"),
  friendList: document.querySelector("#friendList"),
  roomList: document.querySelector("#roomList"),
  presenceCount: document.querySelector("#presenceCount"),
  roomCount: document.querySelector("#roomCount"),
  roomBadge: document.querySelector("#roomBadge"),
  roomTitle: document.querySelector("#roomTitle"),
  roomMeta: document.querySelector("#roomMeta"),
  messageList: document.querySelector("#messageList"),
  composer: document.querySelector("#composer"),
  messageInput: document.querySelector("#messageInput"),
  composerHint: document.querySelector("#composerHint")
};

const palette = ["#c95a2b", "#166b78", "#b78a11", "#7f5af0", "#0f9d58", "#f25f5c"];

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase() || "??";
}

function colorForName(name) {
  const sum = [...(name || "guest")].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return palette[sum % palette.length];
}

function saveName() {
  localStorage.setItem("pulseroom-name", state.me.name);
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function myDisplayName() {
  return state.me.name.trim() || "You";
}

function currentGroup() {
  return state.groups.find((group) => group.id === state.me.groupId) || null;
}

function currentMessages() {
  return state.messages.filter((message) => message.groupId === state.me.groupId);
}

function currentUsers() {
  return state.users
    .filter((user) => user.groupId === state.me.groupId)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function relativeMeta(messages) {
  const count = messages.length;
  if (!count) {
    return "No messages yet";
  }

  const latest = messages[messages.length - 1];
  return `${count} message${count === 1 ? "" : "s"} - last at ${formatTime(latest.createdAt)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

async function refreshData(preserveGroup = true) {
  const data = await api("/api/state");
  state.groups = data.groups;
  state.users = data.users;
  state.messages = data.messages;

  if (!preserveGroup || !state.groups.some((group) => group.id === state.me.groupId)) {
    state.me.groupId = state.groups[0]?.id || null;
  }

  renderApp();
}

function renderProfileSelect() {
  els.profileSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "self";
  option.textContent = myDisplayName();
  els.profileSelect.appendChild(option);
  els.profileSelect.value = "self";
}

function renderGroupSelect() {
  els.roomSelect.innerHTML = "";
  state.groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    els.roomSelect.appendChild(option);
  });
  els.roomSelect.value = state.me.groupId || "";
}

function renderFriends() {
  const users = currentUsers();
  els.friendList.innerHTML = "";

  if (!users.length) {
    els.friendList.innerHTML = '<p class="empty-chat">Nobody has joined this group yet. Share the group name and start the conversation.</p>';
  }

  users.forEach((user) => {
    const isMe = user.name === myDisplayName();
    const card = document.createElement("article");
    card.className = "friend-card";
    card.innerHTML = `
      <div class="avatar" style="background:${colorForName(user.name)}">${initials(user.name)}</div>
      <div>
        <h3>${escapeHtml(user.name)}${isMe ? " (you)" : ""}</h3>
        <p class="friend-status">${escapeHtml(user.status || "Online")}</p>
      </div>
    `;
    els.friendList.appendChild(card);
  });

  els.presenceCount.textContent = `${users.length} online`;
}

function renderGroups() {
  els.roomList.innerHTML = "";

  state.groups.forEach((group) => {
    const groupMessages = state.messages.filter((message) => message.groupId === group.id);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `room-chip${group.id === state.me.groupId ? " active" : ""}`;
    chip.innerHTML = `
      <h3>${escapeHtml(group.name)}</h3>
      <p class="room-chip-meta">${relativeMeta(groupMessages)}</p>
    `;
    chip.addEventListener("click", async () => {
      state.me.groupId = group.id;
      await syncPresence();
      renderApp();
    });
    els.roomList.appendChild(chip);
  });

  els.roomCount.textContent = `${state.groups.length} active`;
}

function renderMessages() {
  const group = currentGroup();
  const messages = currentMessages();
  els.messageList.innerHTML = "";

  if (!group) {
    els.roomBadge.textContent = "No Group";
    els.roomTitle.textContent = "Create a group";
    els.roomMeta.textContent = "The server is running, but no groups exist yet.";
    els.messageList.innerHTML = '<p class="empty-chat">Create your first group and this will turn into a real chat.</p>';
    return;
  }

  els.roomBadge.textContent = group.name;
  els.roomTitle.textContent = `${group.name} group`;
  els.roomMeta.textContent = relativeMeta(messages);

  if (!messages.length) {
    els.messageList.innerHTML = '<p class="empty-chat">This group is quiet. Send the first message and wake it up.</p>';
    return;
  }

  messages.forEach((message) => {
    const mine = message.userName === myDisplayName();
    const row = document.createElement("div");
    row.className = `message-row${mine ? " mine" : ""}`;
    row.innerHTML = `
      <article class="message-bubble">
        <div class="message-meta">
          <span>${mine ? "You" : escapeHtml(message.userName)}</span>
          <span>${formatTime(message.createdAt)}</span>
        </div>
        <p class="message-text">${escapeHtml(message.text)}</p>
      </article>
    `;
    els.messageList.appendChild(row);
  });

  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderInputs() {
  els.nameInput.value = state.me.name;
  const me = currentUsers().find((user) => user.name === myDisplayName());
  els.statusInput.value = me?.status || "";
  els.composerHint.textContent = `${280 - els.messageInput.value.length} left`;
}

function renderApp() {
  renderProfileSelect();
  renderGroupSelect();
  renderFriends();
  renderGroups();
  renderMessages();
  renderInputs();
}

async function syncPresence() {
  if (!state.me.name.trim() || !state.me.groupId) {
    return;
  }

  const payload = {
    name: state.me.name.trim(),
    status: els.statusInput.value.trim() || "Online",
    groupId: state.me.groupId
  };

  await api("/api/presence", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function createGroup() {
  if (!state.me.name.trim()) {
    window.alert("Type your name first so your friends know who made the group.");
    els.nameInput.focus();
    return;
  }

  const name = window.prompt("Name the new group");
  if (!name || !name.trim()) {
    return;
  }

  const data = await api("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      name: name.trim(),
      creatorName: state.me.name.trim()
    })
  });

  state.me.groupId = data.group.id;
  await refreshData();
  await syncPresence();
}

async function sendMessage(text) {
  if (!state.me.name.trim()) {
    window.alert("Add your name first.");
    els.nameInput.focus();
    return;
  }

  if (!state.me.groupId) {
    window.alert("Create or choose a group first.");
    return;
  }

  await api("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      groupId: state.me.groupId,
      userName: state.me.name.trim(),
      text
    })
  });
}

async function seedConversation() {
  const group = currentGroup();
  if (!group) {
    return;
  }

  const seed = [
    { userName: "Aman", text: "Who is coming early tomorrow?" },
    { userName: "Riya", text: "I can. Save me a seat near the window." },
    { userName: "Kabir", text: "Only if someone brings snacks." }
  ];

  for (const item of seed) {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        groupId: group.id,
        userName: item.userName,
        text: item.text
      })
    });
  }
}

function connectStream() {
  state.stream?.close();
  state.stream = new EventSource("/api/stream");
  state.stream.addEventListener("sync", async () => {
    await refreshData();
  });
}

els.nameInput.addEventListener("input", async (event) => {
  state.me.name = event.target.value.trimStart();
  saveName();
  renderProfileSelect();
});

els.nameInput.addEventListener("change", async () => {
  await syncPresence();
  await refreshData();
});

els.roomSelect.addEventListener("change", async (event) => {
  state.me.groupId = event.target.value;
  await syncPresence();
  renderApp();
});

els.statusInput.addEventListener("change", async () => {
  await syncPresence();
  await refreshData();
});

els.newRoomBtn.addEventListener("click", createGroup);
els.seedBtn.addEventListener("click", seedConversation);

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) {
    return;
  }

  await sendMessage(text);
  els.messageInput.value = "";
  renderInputs();
});

els.messageInput.addEventListener("input", () => {
  els.composerHint.textContent = `${280 - els.messageInput.value.length} left`;
});

async function boot() {
  await refreshData(false);
  connectStream();
  if (state.me.groupId) {
    await syncPresence();
    await refreshData();
  }
}

boot().catch((error) => {
  els.messageList.innerHTML = `<p class="empty-chat">${escapeHtml(error.message)}. Start the server and reload this page.</p>`;
});
