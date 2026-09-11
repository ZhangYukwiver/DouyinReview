import type { PersonalVideoRecord } from "../domain/personalRecords";
import { closeExplore, readExplore, type ExploreConnection, type ExplorePage } from "./explorer";
import { LocalCollectorError } from "./localCollector";

export function buildVideoFeed(records: PersonalVideoRecord[], initial: PersonalVideoRecord): PersonalVideoRecord[] {
  const videos = records.filter((item) => item.url && item.mediaType !== "image" && item.mediaType !== "live");
  return videos.some((item) => item.id === initial.id) ? videos : [initial, ...videos];
}

/** A previous media/comment request can still be finishing in the shared collector. */
export async function waitForCollector<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const deadline = Date.now() + 60_000;
  while (true) {
    signal.throwIfAborted();
    try { return await operation(); } catch (error) {
      if (!(error instanceof LocalCollectorError) || error.code !== "collector_busy" || Date.now() >= deadline) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
}

/** Own only this player's comment tab; never close search/profile sessions. */
export function createVideoCommentsSession(connection: ExploreConnection, record: PersonalVideoRecord) {
  const id = record.videoId || /\/(?:video|note)\/(\d+)/u.exec(record.url ?? "")?.[1];
  let sessionId: string | undefined;
  let disposed = false;
  let pending: Promise<ExplorePage> | null = null;
  const controller = new AbortController();
  const release = () => {
    if (!sessionId) return;
    const current = sessionId;
    sessionId = undefined;
    void closeExplore(connection, [current]).catch(() => {});
  };
  return {
    read(): Promise<ExplorePage> {
      if (disposed) return Promise.reject(new DOMException("评论已关闭", "AbortError"));
      if (!id) return Promise.reject(new Error("这条记录缺少作品 ID，请在抖音原页查看评论。"));
      if (pending) return pending;
      pending = waitForCollector(async () => {
        let result: ExplorePage;
        try { result = await readExplore(connection, { kind: "comments", id, sessionId }); }
        catch (error) {
          if (!(error instanceof LocalCollectorError) || error.code !== "session_expired") throw error;
          sessionId = undefined;
          controller.signal.throwIfAborted();
          result = await readExplore(connection, { kind: "comments", id });
        }
        sessionId = result.sessionId;
        // Keep the bounded request alive on close so even a late-created tab is released.
        if (disposed) { release(); controller.signal.throwIfAborted(); }
        return result;
      }, controller.signal).finally(() => { pending = null; if (disposed) release(); });
      return pending;
    },
    close() { disposed = true; controller.abort(); if (!pending) release(); },
  };
}
