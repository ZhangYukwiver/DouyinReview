import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { fx } from "./motion";

/**
 * 内容年志（public/story 下的静态页）在应用内以同源 iframe 承载：采集器 token 与内存里的记录都还在，
 * 卷尾的「进入持续报告」和导航上的「工作台」通过 postMessage({ type: "trace:open-dashboard" }) 交还给 App。
 */
export function StoryFrame({ src }: { src: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, [src]);
  if (Platform.OS !== "web") return null;
  return (
    <View {...fx({ motion: "fade" })} style={styles.root} testID="story-frame">
      <iframe ref={frameRef} src={src} style={frameStyle} title="内容年志" />
    </View>
  );
}

// 入口卡的墨夜底色，iframe 首帧还没画出来时不闪白
const frameStyle = { border: 0, display: "block", width: "100%", height: "100%", background: "#1F1F29" } as const;

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 100, backgroundColor: "#1F1F29" },
});
