import { describe, expect, it, vi } from "vitest";
import { DouyinExplorer, ingestExploreResponse, isExploreApiUrl, maskHeadlessUserAgent, normalizeExploreComment, normalizeExploreUser, normalizeExploreVideo, validateExploreRequest } from "./explorer.mjs";

const author = { sec_uid: "test-public-author", nickname: "离线测试作者", follower_count: 0, follow_status: 0 };
const aweme = (id) => ({ aweme_id: id, desc: "离线测试作品", author, create_time: 1788912000, user_digged: 0, collect_status: 1, statistics: { digg_count: 0 } });
function session(kind = "videos") { return { kind, id: "", items: new Map(), received: false, revision: 0, hasMore: null }; }

describe("explore data boundaries and pagination", () => {
  it("recognizes the regional Douyin response host while keeping the API scope narrow", () => {
    for (const host of ["www.douyin.com", "www-hj.douyin.com"]) {
      expect(isExploreApiUrl(new URL(`https://${host}/aweme/v1/web/comment/list/?aweme_id=123456789`))).toBe(true);
    }
    for (const address of ["https://douyin.com.example.org/aweme/v1/web/comment/list/", "https://example.org/aweme/v1/web/comment/list/", "https://www-hj.douyin.com/other/", "http://www.douyin.com/aweme/v1/web/comment/list/"]) {
      expect(isExploreApiUrl(new URL(address))).toBe(false);
    }
  });
  it("keeps zero distinct from missing metrics and unknown interaction states", () => {
    expect(normalizeExploreUser(author)).toMatchObject({ followers: 0, likes: null, followed: false });
    expect(normalizeExploreUser({ ...author, follow_status: 99 })).toMatchObject({ followed: null });
    expect(normalizeExploreVideo(aweme("12345678901234567"))).toMatchObject({ occurredAt: null, liked: false, collected: true, stats: { diggCount: 0 } });
  });
  it("does not discard one-character comments or preserve arbitrary image URLs", () => {
    expect(normalizeExploreComment({ cid: "c1", text: "好", user: author, digg_count: 0 })).toMatchObject({ text: "好", likes: 0 });
    expect(normalizeExploreUser({ ...author, avatar_thumb: { url_list: ["https://example.invalid/a.png"] } }).avatar).toBeNull();
  });
  it("keeps sticker-only comments visible and filters untrusted comment images", () => {
    expect(normalizeExploreComment({ cid: "sticker", text: "", sticker: { animate_url: { url_list: ["https://p3.douyinpic.com/sticker.webp"] } },
      image_list: [{ origin_url: { url_list: ["https://example.invalid/image.png"] } }], user: author,
    })).toMatchObject({ text: "", images: ["https://p3.douyinpic.com/sticker.webp"] });
  });
  it("merges subsequent pages and trusts an explicit end marker", () => {
    const state = session();
    const pathname = "/aweme/v1/web/search/item/";
    ingestExploreResponse(state, pathname, { status_code: 0, data: [{ aweme_info: aweme("12345678901234567") }], has_more: 1 });
    expect(state.hasMore).toBe(true);
    ingestExploreResponse(state, pathname, { status_code: 0, data: [{ aweme_info: aweme("12345678901234567") }, { aweme_info: aweme("22345678901234567") }], has_more: 0 });
    expect([...state.items.values()]).toHaveLength(2);
    expect(state.hasMore).toBe(false);
    expect(state.revision).toBe(2);
  });
  it("distinguishes an empty page from unrecognized data", () => {
    const empty = session("users");
    ingestExploreResponse(empty, "/aweme/v1/web/discover/search/", { user_list: [], has_more: 0 });
    expect(empty.received).toBe(true); expect(empty.error).toBeUndefined();
    const changed = session("users");
    ingestExploreResponse(changed, "/aweme/v1/web/search/user/", { user_list: [{ unexpected: true }] });
    expect(changed.error.code).toBe("schema_changed");
  });
  it("treats an empty first response as platform risk control, not a missing page", () => {
    const state = session("users");
    ingestExploreResponse(state, "/aweme/v1/web/ab/params/", null);
    expect(state.error).toBeUndefined();
    ingestExploreResponse(state, "/aweme/v1/web/discover/search/", null);
    expect(state.error.code).toBe("platform_error");
  });
  it("hides the headless marker from Douyin before opening pages", async () => {
    const send = vi.fn(async () => {});
    const page = { evaluate: async () => "Mozilla/5.0 HeadlessChrome/152.0.0.0 Safari/537.36", context: () => ({ newCDPSession: async () => ({ send }) }) };
    await expect(maskHeadlessUserAgent(page)).resolves.toBe("Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36");
    expect(send).toHaveBeenCalledWith("Emulation.setUserAgentOverride", expect.objectContaining({ userAgent: "Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36" }));
    await expect(maskHeadlessUserAgent({ evaluate: async () => "Mozilla/5.0 Chrome/152.0.0.0", context: () => { throw new Error("unused"); } })).resolves.toBeNull();
  });
  it("requires a supported kind and a concrete search or identifier", () => {
    for (const input of [{ kind: "unknown" }, { kind: "users", query: " " }, { kind: "detail", id: "invalid" }, { kind: "profile", id: "x" }]) expect(() => validateExploreRequest(input)).toThrow();
    expect(validateExploreRequest({ kind: "users", query: "  建筑  " })).toMatchObject({ query: "建筑" });
  });
  it("does not turn an expired pagination session into a new first page", async () => {
    const context = vi.fn(); const explorer = new DouyinExplorer(context);
    await expect(explorer.read({ kind: "users", query: "建筑", sessionId: "expired" })).rejects.toMatchObject({ code: "session_expired" });
    expect(context).not.toHaveBeenCalled();
  });
});

function interactionPage(initial, clickFailure = false) {
  let pressed = initial;
  const button = { count: async () => 1, evaluate: async () => pressed,
    click: vi.fn(async () => { pressed = !pressed; if (clickFailure) throw new Error("ack lost after click"); }) };
  return { button, pressed: () => pressed, isClosed: () => false, url: () => "https://www.douyin.com/video/12345678901234567", locator: () => button };
}
function interactionExplorer(page) {
  const explorer = new DouyinExplorer(vi.fn());
  explorer.sessions.set("detail-session", { kind: "detail", key: "detail-session", id: "12345678901234567", page, url: page.url() });
  page.reload = async () => { explorer.sessions.get("detail-session").video = { liked: page.pressed(), collected: false }; };
  return explorer;
}
const action = { sessionId: "detail-session", requestId: "one-explicit-user-request", action: "like", desired: true };
describe("single user-directed interactions", () => {
  it("does not toggle an already satisfied state", async () => {
    const page = interactionPage(true);
    await expect(interactionExplorer(page).interact(action)).resolves.toMatchObject({ outcome: "confirmed", value: true });
    expect(page.button.click).not.toHaveBeenCalled();
  });
  it("checks state after a click and deduplicates the same request", async () => {
    const page = interactionPage(false); const explorer = interactionExplorer(page);
    await expect(explorer.interact(action)).resolves.toMatchObject({ outcome: "confirmed", value: true });
    await explorer.interact(action);
    expect(page.button.click).toHaveBeenCalledTimes(1);
  });
  it("keeps a click with a lost acknowledgement pending without a retry", async () => {
    const page = interactionPage(false, true); const explorer = interactionExplorer(page);
    await expect(explorer.interact(action)).resolves.toMatchObject({ outcome: "unknown" });
    await explorer.interact(action);
    expect(page.button.click).toHaveBeenCalledTimes(1);
  });
  it("refuses an unknown state without clicking", async () => {
    const page = interactionPage(null);
    await expect(interactionExplorer(page).interact(action)).resolves.toMatchObject({ outcome: "rejected" });
    expect(page.button.click).not.toHaveBeenCalled();
  }, 12000);
  it("does not let a reused request id target another action", async () => {
    const explorer = interactionExplorer(interactionPage(true));
    await explorer.interact(action);
    await expect(explorer.interact({ ...action, desired: false })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
