import { describe, expect, it } from "vitest";

import { splitChatEmoji } from "./chatEmoji";

describe("splitChatEmoji", () => {
  it("把抖音小表情代码换成图片，其他中括号保留原文", () => {
    const parts = splitChatEmoji("哈哈[宕机][宕机] [不存在的] 结束");
    expect(parts.map((part) => ("emoji" in part ? part.emoji : part.text))).toEqual(["哈哈", "[宕机]", "[宕机]", " ", "[不存在的]", " 结束"]);
    expect(parts.filter((part) => "emoji" in part)).toHaveLength(2);
    expect(parts[1]).toMatchObject({ emoji: "[宕机]", url: expect.stringMatching(/^https:\/\//u) });
    expect(splitChatEmoji("纯文字")).toEqual([{ text: "纯文字" }]);
  });
});
