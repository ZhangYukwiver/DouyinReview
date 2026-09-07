export const REPORT_TILE_GAP = 10;
const MIN_COLUMN_WIDTH = 300;

export function reportColumnCount(width: number, mobile: boolean): number {
  return mobile ? 1 : Math.max(1, Math.min(4, Math.floor((width + REPORT_TILE_GAP) / (MIN_COLUMN_WIDTH + REPORT_TILE_GAP))));
}

/** h 只用于首次测量前估高，排布结果不设置或放大卡片尺寸。 */
export function layoutReportTiles(
  tiles: ReadonlyArray<{ key: string; h: number }>,
  columns: number,
  measured: Readonly<Record<string, number>>,
) {
  const bottoms = Array.from({ length: columns }, () => 0);
  const placed = tiles.map((tile) => {
    let column = 0;
    for (let index = 1; index < columns; index += 1) {
      if (bottoms[index]! < bottoms[column]!) column = index;
    }
    const top = bottoms[column]!;
    bottoms[column] = top + (measured[tile.key] ?? tile.h) + REPORT_TILE_GAP;
    return { column, top };
  });
  return { placed, bottoms, height: Math.max(0, ...bottoms) - (tiles.length ? REPORT_TILE_GAP : 0) };
}

/**
 * 各列末尾剩下的空当：列高不齐时短的那几列下面会空一截。
 * bottoms[column] 已经含了一个间距，所以它就是占位块的顶；高度补到整块的底边为止。
 */
export function reportTrailingGaps(
  bottoms: ReadonlyArray<number>,
  height: number,
  minHeight = 90,
): Array<{ column: number; top: number; height: number }> {
  return bottoms
    .map((bottom, column) => ({ column, top: bottom, height: height - bottom }))
    .filter((gap) => gap.height >= minHeight);
}
