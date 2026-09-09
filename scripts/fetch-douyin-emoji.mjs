// 拉取抖音内置小表情字典（文字代码 → 图片地址），写进 src/domain/douyinEmoji.json。
// 私信里这类表情以 [宕机] 这样的文字代码传输，客户端靠这张表画成小图。
// 用法：node scripts/fetch-douyin-emoji.mjs
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/domain/douyinEmoji.json");
const response = await fetch("https://www.douyin.com/aweme/v1/web/emoji/list/?device_platform=webapp&aid=6383", {
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Referer: "https://www.douyin.com/",
  },
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { emoji_list: list } = await response.json();
const map = {};
for (const item of Array.isArray(list) ? list : []) {
  const name = item?.display_name;
  const url = item?.emoji_url?.url_list?.[0];
  if (item?.hide === 0 && typeof name === "string" && /^\[[^[\]]{1,8}\]$/u.test(name) && typeof url === "string" && url.startsWith("https://")) map[name] = url;
}
const count = Object.keys(map).length;
if (count < 100) throw new Error(`只拿到 ${count} 个表情，接口可能变了`);
await writeFile(target, `${JSON.stringify(map, null, 2)}\n`);
console.log(`写入 ${count} 个表情 → ${path.relative(process.cwd(), target)}`);
