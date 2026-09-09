import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeChatPayload, ChatMessageAccumulator } from "./chatNormalizer.mjs";
import { CollectorStore } from "./store.mjs";
import { createEmptyRecords } from "./normalizer.mjs";
import { getCollectorRecords } from "../src/services/localCollector.ts";

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])("updates old cards through storage and the client without mistaking a video title for a comment (image only: %s)", async (imageOnly) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dy-comment-roundtrip-"));
  try {
    const old = { id: "shared-comment", conversationId: "friend-1", conversationType: "friend", senderName: "转发好友", type: "share", text: "旧正文", share: { title: "视频标题", url: "https://www.douyin.com/video/123456" } };
    const accumulator = new ChatMessageAccumulator([old]);
    const { messages } = normalizeChatPayload({ msgs: [{
      server_id: old.id, conv_id: old.conversationId, conversation_type: 1, type_code: 105,
      content_json: { itemId: "123456", aweme_title: "视频标题", comment_id: "987654", comment: imageOnly ? "" : "评论正文", comment_user_name: "评论作者", comment_url: { url_list: ["https://evil.example/comment.jpg"] }, comment_content_type: 2, media_type: imageOnly ? 2 : 1 },
    }] });
    accumulator.addMessages(messages);
    const store = new CollectorStore(directory);
    await store.save(createEmptyRecords(), [], { chatMessages: accumulator.snapshot(), chatConversations: [] });
    const stored = await store.load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(stored))));
    const client = await getCollectorRecords("http://127.0.0.1:4765", "test-token");
    expect(client.chatMessages).toHaveLength(1);
    expect(client.chatMessages[0]).toMatchObject({
      id: old.id, type: "comment", senderName: "转发好友", text: imageOnly ? null : "评论正文",
      comment: { id: "987654", author: "评论作者", text: imageOnly ? null : "评论正文", mediaUrl: null, mediaType: "image", sourceType: imageOnly ? "image" : "video" },
      share: { title: "视频标题", url: "https://www.douyin.com/video/123456" },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
