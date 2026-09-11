import React, { memo, useEffect, useRef, useState } from "react";
import { Modal } from "react-native";
import { ArrowUpRight, Bookmark, ChevronDown, ChevronUp, Heart, MessageCircle, Music2, Pause, Play, Volume2, VolumeX, X } from "lucide-react-native";
import type { PersonalVideoRecord } from "../../domain/personalRecords";
import type { ExploreComment, ExploreConnection, ExplorePage } from "../../services/explorer";
import { buildVideoFeed, createVideoCommentsSession, waitForCollector } from "../../services/videoFeed";
import "./RecordVideoPlayer.css";

export type RecordVideoLoader = (record: PersonalVideoRecord, signal: AbortSignal) => Promise<Blob>;
const count = (value?: number | null) => value == null ? "—" : value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/u, "")}万` : value.toLocaleString("zh-CN");
const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("zh-CN") : "";

type Props = {
  record: PersonalVideoRecord;
  records?: PersonalVideoRecord[];
  onLoadVideo: RecordVideoLoader;
  commentsConnection?: ExploreConnection | null;
  onOpenRecord?: (url: string) => Promise<void>;
  onClose: () => void;
};

export function RecordVideoPlayer({ record, records, onLoadVideo, commentsConnection = null, onOpenRecord, onClose }: Props) {
  // Freeze the opened list so background collection cannot reorder a playing feed.
  const [feed] = useState(() => buildVideoFeed(records ?? [record], record));
  const [index, setIndex] = useState(() => Math.max(0, feed.findIndex((item) => item.id === record.id)));
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const active = feed[index]!;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const move = (direction: number) => setIndex((current) => Math.max(0, Math.min(feed.length - 1, current + direction)));
  const toggleComments = () => {
    setCommentsOpen(!commentsOpen);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(commentsOpen ? '[aria-label="查看评论"]' : '[aria-label="关闭评论"]')?.focus());
  };

  useEffect(() => { rootRef.current?.focus(); }, []);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let last = 0, delta = 0, consumed = false;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        (event.target as Element).closest("[data-feed-controls],[data-comments-panel]")) return;
      event.preventDefault();
      const now = performance.now();
      if (now - last > 180) { delta = 0; consumed = false; }
      last = now;
      if (consumed) return;
      delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewer.clientHeight : 1);
      if (Math.abs(delta) < 65) return;
      consumed = true;
      setIndex((current) => Math.max(0, Math.min(feed.length - 1, current + Math.sign(delta))));
    };
    viewer.addEventListener("wheel", wheel, { passive: false });
    return () => viewer.removeEventListener("wheel", wheel);
  }, [feed.length]);

  return <Modal animationType="fade" transparent visible onRequestClose={() => commentsOpen ? toggleComments() : onClose()}>
    <div ref={rootRef} className="rv-backdrop" tabIndex={-1} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if ((event.target as Element).closest("input,a,[data-comments-panel]")) return;
        if (["ArrowDown", "PageDown", "ArrowUp", "PageUp"].includes(event.key)) {
          event.preventDefault(); move(["ArrowDown", "PageDown"].includes(event.key) ? 1 : -1);
        }
      }}>
      <div className="rv-layout" aria-label="视频播放器" role="dialog" aria-modal="true">
        <div ref={viewerRef} className="rv-viewer"
          onTouchStart={(event) => {
            const first = event.touches[0];
            touch.current = event.touches.length === 1 && first && !(event.target as Element).closest("button,input,a,[data-feed-controls],[data-comments-panel]")
              ? { x: first.clientX, y: first.clientY } : null;
          }}
          onTouchCancel={() => { touch.current = null; }}
          onTouchEnd={(event) => {
            const first = event.changedTouches[0], start = touch.current;
            touch.current = null;
            if (!first || !start) return;
            const dy = start.y - first.clientY;
            if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(start.x - first.clientX) * 1.3) move(dy > 0 ? 1 : -1);
          }}>
          {active.coverUrl ? <div className="rv-ambient" style={{ backgroundImage: `url(${JSON.stringify(active.coverUrl)})` }} aria-hidden="true" /> : null}
          <Playback key={active.id} record={active} onLoadVideo={onLoadVideo} muted={muted} onToggleMute={() => setMuted((value) => !value)}
            commentsOpen={commentsOpen} onToggleComments={toggleComments} onOpenRecord={onOpenRecord}
            commentsConnection={commentsConnection} position={`${index + 1} / ${feed.length}`} onClose={onClose} />
          <nav className="rv-navigation" aria-label="切换视频">
            <button className="rv-icon-button" aria-label="上一个视频" disabled={index === 0} onClick={() => move(-1)}><ChevronUp color="#fff" size={24} /></button>
            <button className="rv-icon-button" aria-label="下一个视频" disabled={index === feed.length - 1} onClick={() => move(1)}><ChevronDown color="#fff" size={24} /></button>
            <span>{index === feed.length - 1 ? "已到最后" : "上下滑动"}</span>
          </nav>
        </div>
      </div>
    </div>
  </Modal>;
}

function Playback({ record, onLoadVideo, muted, onToggleMute, commentsOpen, onToggleComments, commentsConnection, position, onClose, onOpenRecord }: {
  record: PersonalVideoRecord; onLoadVideo: RecordVideoLoader; muted: boolean; onToggleMute: () => void;
  commentsOpen: boolean; onToggleComments: () => void; commentsConnection: ExploreConnection | null;
  position: string; onClose: () => void; onOpenRecord?: (url: string) => Promise<void>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loaderRef = useRef(onLoadVideo);
  loaderRef.current = onLoadVideo;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const video = videoRef.current;
    setSrc(null); setError(null); setPaused(true); setElapsed(0); setDuration(0);
    void (async () => {
      try {
        const blob = await waitForCollector(() => loaderRef.current(record, controller.signal), controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "视频暂时无法播放，请稍后重试。");
      }
    })();
    return () => {
      controller.abort(); video?.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id, record.url, attempt]);
  useEffect(() => {
    if (src) void videoRef.current?.play().catch(() => {});
  }, [src]);
  const toggle = () => {
    const video = videoRef.current;
    if (!src || !video) return;
    if (video.paused) void video.play().catch(() => setError("无法开始播放，请重试。"));
    else video.pause();
  };

  return <>
    <div className="rv-stage" data-testid="video-feed-stage" onKeyDown={(event) => {
      if (event.code === "Space" && !(event.target as Element).closest("button,input,a")) { event.preventDefault(); toggle(); }
    }}>
      <video ref={videoRef} aria-label={`${record.title}，视频播放`} src={src ?? undefined} poster={record.coverUrl ?? undefined}
        autoPlay loop playsInline muted={muted} preload="auto" onClick={toggle} tabIndex={0}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
        onTimeUpdate={() => setElapsed(videoRef.current?.currentTime ?? 0)}
        onDurationChange={() => { const value = videoRef.current?.duration; setDuration(value && Number.isFinite(value) ? value : 0); }}
        onError={() => { if (src) setError("视频无法播放，请重试或打开抖音原视频。"); }} />
      <div className="rv-shade" aria-hidden="true" />
      <header className="rv-topbar">
        <button className="rv-icon-button" aria-label="关闭视频" onClick={onClose}><X color="#fff" size={24} /></button>
        <span className="rv-heading">工作台<span>当前列表</span></span>
        <span className="rv-position" aria-live="polite" aria-label="当前视频序号">{position}</span>
      </header>
      {!src || error ? <div className="rv-message" role={error ? "alert" : "status"}>
        {error ? <><p>{error}</p><button className="rv-button" onClick={() => setAttempt((value) => value + 1)}>重试播放</button>
          {record.url && onOpenRecord ? <button className="rv-text-button" onClick={() => void onOpenRecord(record.url!)}>打开抖音原视频</button> : null}</>
          : <><span className="rv-spinner" /><p>正在准备视频…</p></>}
      </div> : paused ? <button className="rv-play-overlay" aria-label="开始播放" onClick={toggle}><Play color="#fff" fill="#fff" size={48} /></button> : null}
      <aside className="rv-actions" aria-label="作品信息与操作">
        <div className="rv-avatar" aria-label={`作者：${record.author ?? "抖音用户"}`}>
          {record.authorAvatarUrl ? <img src={record.authorAvatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{(record.author ?? "抖").slice(0, 1)}</span>}
        </div>
        <div className="rv-stat" aria-label={`获赞 ${count(record.stats?.diggCount)}`}><Heart color="#fff" fill="#fff" size={31} /><span>{count(record.stats?.diggCount)}</span></div>
        <button className={`rv-stat ${commentsOpen ? "rv-selected" : ""}`} aria-label="查看评论" aria-expanded={commentsOpen} onClick={onToggleComments}>
          <MessageCircle color={commentsOpen ? "#ff2c55" : "#fff"} fill={commentsOpen ? "#ff2c55" : "#fff"} size={31} /><span>{count(record.stats?.commentCount)}</span>
        </button>
        <div className="rv-stat" aria-label={`收藏 ${count(record.stats?.collectCount)}`}><Bookmark color="#fff" fill="#fff" size={29} /><span>{count(record.stats?.collectCount)}</span></div>
        {record.url && onOpenRecord ? <button className="rv-stat" aria-label="打开抖音原视频" onClick={() => void onOpenRecord(record.url!)}><ArrowUpRight color="#fff" size={32} /><span>原视频</span></button> : null}
      </aside>
      <div className="rv-caption">
        <strong>@{record.author ?? "抖音用户"}</strong>
        <p title={record.title}>{record.title}</p>
        {record.music?.title ? <div className="rv-music"><Music2 color="#fff" size={15} /><span>{record.music.title}{record.music.author ? ` · ${record.music.author}` : ""}</span></div> : null}
        {record.publishedAt ? <small>{date(record.publishedAt)}</small> : null}
      </div>
      <div className="rv-controls" data-feed-controls>
        <div className="rv-control-row">
          <button className="rv-icon-button" aria-label={paused ? "播放视频" : "暂停视频"} disabled={!src || Boolean(error)} onClick={toggle}>
            {paused ? <Play color="#fff" fill="#fff" size={17} /> : <Pause color="#fff" fill="#fff" size={17} />}
          </button>
          <span>{time(elapsed)} / {time(duration)}</span><span className="rv-control-spacer" />
          <button className="rv-icon-button" aria-label={muted ? "开启声音" : "静音"} onClick={onToggleMute}>{muted ? <VolumeX color="#fff" size={21} /> : <Volume2 color="#fff" size={21} />}</button>
        </div>
        <input aria-label="视频进度" type="range" min={0} max={duration || 1} step={0.1} value={Math.min(elapsed, duration || 1)} disabled={!duration}
          onChange={(event) => { if (videoRef.current) { videoRef.current.currentTime = Number(event.target.value); setElapsed(Number(event.target.value)); } }} />
      </div>
    </div>
    {commentsOpen ? <VideoComments record={record} connection={commentsConnection} ready={Boolean(src || error)} onClose={onToggleComments} onOpenRecord={onOpenRecord} /> : null}
  </>;
}

const VideoComments = memo(function VideoComments({ record, connection, ready, onClose, onOpenRecord }: {
  record: PersonalVideoRecord; connection: ExploreConnection | null; ready: boolean; onClose: () => void;
  onOpenRecord?: (url: string) => Promise<void>;
}) {
  const [page, setPage] = useState<ExplorePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<ReturnType<typeof createVideoCommentsSession> | null>(null);
  useEffect(() => {
    const session = connection ? createVideoCommentsSession(connection, record) : null;
    sessionRef.current = session;
    setPage(null); setError(null);
    return () => { session?.close(); sessionRef.current = null; };
  }, [connection?.baseUrl, connection?.token, record.id]);
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !ready) return;
    let current = true;
    setLoading(true); setError(null);
    void session.read().then((next) => { if (current) setPage(next); }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : "评论读取失败，请稍后重试。");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [connection?.baseUrl, connection?.token, record.id, ready, attempt]);
  return <section className="rv-comments" data-comments-panel aria-label="视频评论" onKeyDown={(event) => event.stopPropagation()}>
    <header className="rv-comments-header"><h2>评论 <span>{count(record.stats?.commentCount)}</span></h2>
      <button className="rv-icon-button" aria-label="关闭评论" onClick={onClose}><X color="#fff" size={21} /></button></header>
    <p className="rv-comments-context" title={record.title}>@{record.author ?? "抖音用户"} · {record.title}</p>
    <div className="rv-comment-list" tabIndex={0}>
      {!connection ? <p className="rv-comment-notice">连接本地采集器后可查看评论。</p> : null}
      {connection && (!ready || loading) ? <div className="rv-comment-notice" role="status"><span className="rv-spinner" /><p>{ready ? "正在读取评论…" : "视频准备好后读取评论…"}</p></div> : null}
      {error ? <div className="rv-comment-notice" role="alert"><p>{error}</p><button className="rv-button" onClick={() => setAttempt((value) => value + 1)}>重试评论</button></div> : null}
      {(page?.items as ExploreComment[] | undefined)?.map((comment) => <article className="rv-comment" key={comment.id}>
        <div className="rv-comment-avatar">{comment.author?.avatar ? <img src={comment.author.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" /> : comment.name.slice(0, 1)}</div>
        <div className="rv-comment-body"><strong>{comment.name}</strong>
          {comment.text ? <p>{comment.text}</p> : !comment.images?.length ? <p>图片或表情评论，请在原页查看</p> : null}
          {comment.images?.map((url) => <img className="rv-comment-image" key={url} src={url} alt="评论图片或表情" referrerPolicy="no-referrer" loading="lazy" />)}
          <small>{date(comment.publishedAt)}{comment.replies > 0 ? ` · ${comment.replies} 条回复（原页查看）` : ""}</small></div>
        <div className="rv-comment-likes" aria-label={`${count(comment.likes)} 个赞`}><Heart color="#929298" size={15} /><span>{count(comment.likes)}</span></div>
      </article>)}
      {page && !page.items.length && !loading && !error ? <p className="rv-comment-notice">暂时没有评论</p> : null}
      {page?.limited ? <p className="rv-comment-notice">已展示 500 条，可在原页继续查看。</p> : page && page.hasMore !== false ?
        <button className="rv-more" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>{loading ? "正在加载…" : "加载更多评论"}</button> : page?.items.length ? <p className="rv-comment-end">已显示全部已返回评论</p> : null}
    </div>
    <footer className="rv-comments-footer">{record.url && onOpenRecord ? <button className="rv-more" onClick={() => void onOpenRecord(record.url!)}>在抖音查看回复与参与讨论 <ArrowUpRight color="#ddd" size={15} /></button> : <span>评论来自抖音公开页面</span>}</footer>
  </section>;
});
