import { normalizeChatSocketPayload } from "./chatNormalizer.mjs";

export function isChatSocketUrl(value) {
  try {
    const url = new URL(value);
    return ["ws:", "wss:"].includes(url.protocol)
      && ["frontier-im.douyin.com", "frontier-im.snssdk.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Observe incoming frames without replacing WebSocket or sending any traffic. */
export function observeChatSockets(context, { onPayload, onConnection, onError }) {
  let active = true;
  let connection = "connecting";
  const pages = new Map();
  const sockets = new Map();
  const connected = new Set();
  const updateConnection = (next) => {
    if (!active || connection === next) return;
    connection = next;
    onConnection(next);
  };
  const attachSocket = (socket) => {
    if (!active || sockets.has(socket) || !isChatSocketUrl(socket.url())) return;
    const frame = ({ payload }) => {
      if (!active) return;
      connected.add(socket);
      updateConnection("connected");
      try {
        const normalized = normalizeChatSocketPayload(payload);
        if (normalized) onPayload(normalized);
      } catch (error) {
        onError(error);
      }
    };
    const close = () => {
      connected.delete(socket);
      socket.off("framereceived", frame);
      socket.off("close", close);
      socket.off("socketerror", error);
      sockets.delete(socket);
      if (connected.size === 0) updateConnection("reconnecting");
    };
    const error = () => {
      connected.delete(socket);
      if (connected.size === 0) updateConnection("reconnecting");
    };
    socket.on("framereceived", frame);
    socket.on("close", close);
    socket.on("socketerror", error);
    sockets.set(socket, () => {
      socket.off("framereceived", frame);
      socket.off("close", close);
      socket.off("socketerror", error);
    });
  };
  const attachPage = (page) => {
    if (!active || pages.has(page) || typeof page.on !== "function") return;
    const close = () => {
      page.off("websocket", attachSocket);
      page.off("close", close);
      pages.delete(page);
    };
    page.on("websocket", attachSocket);
    page.on("close", close);
    pages.set(page, close);
  };
  context.on("page", attachPage);
  for (const page of context.pages()) attachPage(page);
  return () => {
    active = false;
    context.off("page", attachPage);
    for (const close of pages.values()) close();
    for (const dispose of sockets.values()) dispose();
    pages.clear();
    sockets.clear();
    connected.clear();
  };
}
