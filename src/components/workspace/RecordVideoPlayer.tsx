import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Play, X } from "lucide-react-native";
import type { PersonalVideoRecord } from "../../domain/personalRecords";
import { workspaceColors as color, workspaceFonts as font, workspaceRadii as radius } from "./workspaceTheme";

export type RecordVideoLoader = (record: PersonalVideoRecord, signal: AbortSignal) => Promise<Blob>;

export function RecordVideoPlayer({ record, onLoadVideo, onClose }: {
  record: PersonalVideoRecord;
  onLoadVideo: RecordVideoLoader;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [needsPlay, setNeedsPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loaderRef = useRef(onLoadVideo);
  loaderRef.current = onLoadVideo;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const video = videoRef.current;
    setSrc(null);
    setError(null);
    setNeedsPlay(false);
    void (async () => {
      try {
        const blob = await loaderRef.current(record, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "视频暂时无法播放，请稍后重试。");
        }
      }
    })();
    return () => {
      controller.abort();
      video?.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record, attempt]);

  useEffect(() => {
    if (!src) return;
    let current = true;
    void videoRef.current?.play().catch(() => { if (current) setNeedsPlay(true); });
    return () => { current = false; };
  }, [src]);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessible={false} focusable={false} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityLabel="视频播放器" style={styles.panel}>
          <View style={styles.header}>
            <Text numberOfLines={2} style={styles.title}>{record.title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭视频" onPress={onClose} style={styles.close}>
              <X color={color.text} size={22} />
            </Pressable>
          </View>
          <View style={styles.media}>
            <video
              ref={videoRef}
              aria-label={`${record.title}，视频播放`}
              src={src ?? undefined}
              poster={record.coverUrl ?? undefined}
              autoPlay
              controls={Boolean(src)}
              playsInline
              onPlay={() => setNeedsPlay(false)}
              onError={() => { if (src) setError("视频无法播放，请重试或使用卡片上的“跳转”打开原视频。"); }}
              style={{ display: "block", width: "100%", height: "min(68vh, 640px)", objectFit: "contain", backgroundColor: "#000" }}
            />
            {!src || error ? (
              <View style={styles.message}>
                {error ? (
                  <>
                    <Text accessibilityRole="alert" style={styles.messageText}>{error}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.retry}>
                      <Text style={styles.retryText}>重试播放</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <ActivityIndicator color="#fff" size="large" />
                    <Text accessibilityLiveRegion="polite" style={styles.messageText}>正在准备视频…</Text>
                  </>
                )}
              </View>
            ) : needsPlay ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="开始播放"
                onPress={() => { void videoRef.current?.play().catch(() => setError("无法开始播放，请重试。")); }}
                style={styles.play}
              >
                <Play color="#fff" fill="#fff" size={30} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.78)" },
  panel: { width: "100%", maxWidth: 960, overflow: "hidden", borderRadius: radius.medium, backgroundColor: color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  title: { flex: 1, color: color.text, fontFamily: font.body, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  media: { position: "relative", backgroundColor: "#000" },
  message: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "rgba(0,0,0,0.68)" },
  messageText: { color: "#fff", fontFamily: font.body, fontSize: 14, lineHeight: 22, textAlign: "center" },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.small, backgroundColor: "#fff" },
  retryText: { color: "#111", fontFamily: font.body, fontWeight: "700" },
  play: { position: "absolute", top: "50%", left: "50%", marginLeft: -32, marginTop: -32, width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.65)" },
});
