import { describe, expect, it } from "vitest";
import { layoutReportTiles, reportColumnCount, reportTrailingGaps, REPORT_TILE_GAP } from "./reportLayout";

describe("持续报告自动补位", () => {
  it("将后续卡片填到短卡片下方，保留实际内容高度", () => {
    const tiles = ["long", "short", "next", "last"].map((key) => ({ key, h: 300 }));
    const layout = layoutReportTiles(tiles, 2, { long: 300, short: 100, next: 120, last: 80 });

    expect(layout.placed).toEqual([
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 1, top: 110 },
      { column: 1, top: 240 },
    ]);
    expect(layout.height).toBe(320);
  });

  it("内容减少后收回占位，重新向上补齐", () => {
    const tiles = ["a", "b", "c"].map((key) => ({ key, h: 300 }));
    const before = layoutReportTiles(tiles, 2, { a: 250, b: 200, c: 100 });
    const after = layoutReportTiles(tiles, 2, { a: 100, b: 200, c: 100 });

    expect(before.placed[2]).toEqual({ column: 1, top: 210 });
    expect(after.placed[2]).toEqual({ column: 0, top: 110 });
    expect(after.height).toBe(210);
  });

  it.each([1, 2, 3, 4])("%i 列布局中每张卡片完整保留，同列只留固定间距", (columns) => {
    const tiles = Array.from({ length: 23 }, (_, index) => ({ key: String(index), h: 100 + index * 17.5 }));
    const layout = layoutReportTiles(tiles, columns, {});
    const bottoms = Array.from({ length: columns }, () => 0);

    expect(layout.placed).toHaveLength(tiles.length);
    layout.placed.forEach(({ column, top }, index) => {
      expect(top).toBe(bottoms[column]);
      bottoms[column] = top + tiles[index]!.h + REPORT_TILE_GAP;
    });
    expect(layout.height).toBe(Math.max(...bottoms) - REPORT_TILE_GAP);
    expect(layout.bottoms).toEqual(bottoms);
  });

  it("桌面按可用宽度切换列数，移动端保持单列", () => {
    expect([350, 609, 610, 919, 920, 1229, 1230, 2400].map((width) => reportColumnCount(width, false)))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(reportColumnCount(800, true)).toBe(1);
    expect(reportColumnCount(0, false)).toBe(1);
  });

  it("没有卡片时不保留多余高度", () => {
    expect(layoutReportTiles([], 4, {})).toEqual({ placed: [], bottoms: [0, 0, 0, 0], height: 0 });
  });

  it("只给短列的末尾留占位，最高的一列和碎缝都跳过", () => {
    const layout = layoutReportTiles(["a", "b", "c"].map((key) => ({ key, h: 300 })), 3, { a: 400, b: 200, c: 396 });

    expect(layout.height).toBe(400);
    expect(reportTrailingGaps(layout.bottoms, layout.height)).toEqual([{ column: 1, top: 210, height: 190 }]);
    expect(reportTrailingGaps(layout.bottoms, layout.height, 200)).toEqual([]);
  });
});
