import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { normalizeChatSocketPayload, ChatMessageAccumulator } from "./chatNormalizer.mjs";
import { isChatSocketUrl, observeChatSockets } from "./chatRealtime.mjs";

const join = (...chunks) => Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
function varint(value) {
  const result = [];
  while (value > 127) { result.push(value % 128 | 128); value = Math.floor(value / 128); }
  return [...result, value];
}
function field(id, value) {
  return typeof value === "number"
    ? join(varint(id * 8), varint(value))
    : join(varint(id * 8 + 2), varint(Buffer.byteLength(value)), Buffer.from(value));
}
function notification(id = 12345, text = "即时消息", conversationType = 1) {
  const message = join(field(1, "friend-live"), field(3, id), field(6, 7), field(7, "sender"), field(8, JSON.stringify({ text })), field(10, 1700000000));
  const body = join(field(2, "friend-live"), field(3, conversationType), field(5, message));
  return join(field(1, 500), field(3, 0), field(6, field(500, body)));
}
function frame(payload, encoding = "") {
  return join(field(1, 1), field(3, 1), field(6, encoding), field(7, "pb"), field(8, payload));
}
function literalLz4(bytes) {
  const prefix = [Math.min(15, bytes.length) << 4];
  if (bytes.length >= 15) {
    let remaining = bytes.length - 15;
    while (remaining >= 255) { prefix.push(255); remaining -= 255; }
    prefix.push(remaining);
  }
  return join(prefix, bytes);
}
const socket = () => Object.assign(new EventEmitter(), { url: () => "wss://frontier-im.douyin.com/ws/v2" });

describe("incoming chat frames", () => {
  it.each(["plain", "compressed", "response"])("decodes a %s protobuf notification", (format) => {
    const response = notification();
    const bytes = format === "response" ? response : frame(format === "compressed" ? literalLz4(response) : response, format === "compressed" ? "__lz4" : "");
    expect(normalizeChatSocketPayload(bytes)).toMatchObject({
      hasMore: null,
      messages: [{ id: "12345", conversationId: "friend-live", conversationType: "friend", text: "即时消息", senderId: "sender", sentAt: "2023-11-14T22:13:20.000Z" }],
    });
  });

  it("normalizes JSON notifications using the SDK field names", () => {
    const payload = JSON.stringify({ body: { has_new_message_notify: {
      conversation_id: "friend-live", conversation_type: 1,
      message: { server_message_id: "12345", sender: "sender", message_type: 7, create_time: 1700000000, content: JSON.stringify({ text: "即时消息" }) },
    } } });
    expect(normalizeChatSocketPayload(payload).messages[0]).toMatchObject({ id: "12345", conversationId: "friend-live", conversationType: "friend", text: "即时消息", senderId: "sender" });
  });

  it("keeps one message when history, notification and reconnect repeat its ID", () => {
    const accumulator = new ChatMessageAccumulator();
    for (let attempt = 0; attempt < 3; attempt += 1) accumulator.addMessages(normalizeChatSocketPayload(frame(notification())).messages);
    expect(accumulator.snapshot()).toHaveLength(1);
  });

  it("ignores heartbeats and other commands, and rejects corrupt compressed frames", () => {
    for (const payload of ["hi", "pong", Buffer.from("hi"), Buffer.from("pong"), frame(field(1, 201))]) {
      expect(normalizeChatSocketPayload(payload)).toBeNull();
    }
    expect(() => normalizeChatSocketPayload(frame(Buffer.from([0, 0, 0]), "__lz4"))).toThrow();
    expect(() => normalizeChatSocketPayload(frame(Buffer.from([0xf0, 0xff]), "__lz4"))).toThrow();
    expect(() => normalizeChatSocketPayload(Buffer.alloc(24 * 1024 * 1024 + 1))).toThrow();
  });
});

describe("chat socket observer", () => {
  it("only observes the IM service and restores all listeners on disposal", () => {
    const page = new EventEmitter();
    const context = Object.assign(new EventEmitter(), { pages: () => [page] });
    const onPayload = vi.fn(), onConnection = vi.fn(), onError = vi.fn();
    const dispose = observeChatSockets(context, { onPayload, onConnection, onError });
    const first = socket();
    page.emit("websocket", first);
    first.emit("framereceived", { payload: "hi" });
    first.emit("framereceived", { payload: frame(notification()) });
    expect(onConnection).toHaveBeenLastCalledWith("connected");
    expect(onPayload).toHaveBeenCalledTimes(1);
    first.emit("close");
    expect(onConnection).toHaveBeenLastCalledWith("reconnecting");
    expect(first.listenerCount("framereceived")).toBe(0);

    const secondPage = new EventEmitter(), next = socket();
    context.emit("page", secondPage);
    secondPage.emit("websocket", next);
    next.emit("framereceived", { payload: frame(notification(12346)) });
    expect(onConnection).toHaveBeenLastCalledWith("connected");
    expect(onPayload).toHaveBeenCalledTimes(2);
    next.emit("framereceived", { payload: "invalid JSON" });
    expect(onError).toHaveBeenCalledTimes(1);
    dispose();
    for (const emitter of [context, page, secondPage, first, next]) expect(emitter.eventNames()).toEqual([]);
    next.emit("framereceived", { payload: frame(notification(12347)) });
    expect(onPayload).toHaveBeenCalledTimes(2);
  });

  it("matches only exact supported WebSocket hosts", () => {
    expect(isChatSocketUrl("wss://frontier-im.douyin.com/ws/v2")).toBe(true);
    expect(isChatSocketUrl("wss://frontier-im.snssdk.com/ws/v2")).toBe(true);
    for (const url of ["https://frontier-im.douyin.com/", "wss://frontier-im.douyin.com.example/", "wss://other.example/", "invalid"]) expect(isChatSocketUrl(url)).toBe(false);
  });
});
