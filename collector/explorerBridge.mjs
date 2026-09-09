import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DouyinExplorer, ExploreError } from "./explorer.mjs";
import { downloadDouyinVideo } from "./videoDownloader.mjs";

// Additive adapter. The original collector and its download jobs retain their
// behavior and data format. Explore owns its tabs and temporary playback files.
export class ExplorerBridge {
  constructor(collector) {
    this.collector = collector;
    this.pending = null;
    this.ownedContext = null;
    this.explorer = new DouyinExplorer(async () => {
      let context = collector.contextHeadless ? collector.context : null;
      if (!context) {
        // Explore runs headless on the shared profile; an idle visible collector window is swapped out first.
        const before = collector.getStatus();
        context = await collector.ensureBrowser({ headless: true });
        this.ownedContext = context;
        if (collector.getStatus().state === "launching_browser") collector.updateStatus({ state: before.state, message: before.message });
      }
      // Headless pages cannot show Douyin's login dialog, so require a prior visible login.
      if (!await collector.hasLoginSession(context, null)) throw new ExploreError("login_required", "搜索在后台无头运行，请先在手动监听中登录一次抖音。");
      return context;
    });
  }
  get busy() { return this.pending !== null; }
  collectorBusy() {
    const current = this.collector;
    return Boolean(current.syncPromise || (current.observationPromise && !current.isChatReceiving?.()) || current.accountSwitchPromise || current.hasActiveVideoDownload());
  }
  async run(input, operation = "read", signal) {
    if (this.busy || this.collectorBusy()) throw new ExploreError("collector_busy", "采集器正在执行任务，请停止采集或等待完成后再探索。");
    const work = Promise.resolve().then(() => operation === "interact" ? this.explorer.interact(input) : operation === "video" ? this.video(input, signal) : this.explorer.read(input));
    this.pending = work;
    try { return await work; } finally { if (this.pending === work) this.pending = null; }
  }
  async video(input, signal) {
    const session = this.explorer.sessions.get(input?.sessionId);
    if (!session || session.kind !== "detail" || !session.video?.url || session.page.isClosed())
      throw new ExploreError("session_expired", "请重新打开作品详情后播放。", 410);
    const directory = await mkdtemp(path.join(tmpdir(), "douyin-explore-media-"));
    const dispose = () => rm(directory, { recursive: true, force: true });
    try {
      const file = await downloadDouyinVideo({ context: session.page.context(), sourceUrl: session.video.url, outputDirectory: directory, signal });
      return { ...file, dispose };
    } catch (error) { await dispose(); throw error; }
  }
  async close(sessionIds) {
    if (this.pending) await this.pending.catch(() => {});
    const selected = Array.isArray(sessionIds) ? sessionIds.slice(0, 100) : [...this.explorer.sessions.keys()];
    const work = (async () => {
      for (const id of selected) {
        const session = this.explorer.sessions.get(id);
        if (session) { this.explorer.sessions.delete(id); await session.page.close().catch(() => {}); }
      }
      if (!this.explorer.sessions.size && this.ownedContext && !this.collector.observationPromise && !this.collectorBusy()) {
        const context = this.ownedContext; this.ownedContext = null;
        await context.close().catch(() => {});
      }
    })();
    this.pending = work;
    try { await work; } finally { if (this.pending === work) this.pending = null; }
  }
}
