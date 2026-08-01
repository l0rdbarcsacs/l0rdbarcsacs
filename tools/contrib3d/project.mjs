/* Isometric projection for the contribution grid. Screen space only: y grows
   downward, height lifts a point upward. Knows nothing about color or SVG. */

/** Project grid cell (col,row) at box-height h into screen space. */
export function isoPoint(col, row, h, {tileW, tileH}) {
  return {
    x: (col - row) * (tileW / 2),
    y: (col + row) * (tileH / 2) - h,
  }
}

/** The three visible faces of a box, each as a 4-point quad in draw order.
 *  Painter's algorithm draws top last so it wins the overlap. */
export function boxFaces(col, row, h, geo) {
  const c = (dc, dr, dh) => isoPoint(col + dc, row + dr, dh, geo)

  const topN = c(0, 0, h)            // north apex
  const topE = c(1, 0, h)            // east
  const topS = c(1, 1, h)            // south
  const topW = c(0, 1, h)            // west
  const baseE = c(1, 0, 0)
  const baseS = c(1, 1, 0)
  const baseW = c(0, 1, 0)

  return {
    left:  [topW, topS, baseS, baseW],
    right: [topS, topE, baseE, baseS],
    top:   [topN, topE, topS, topW],
  }
}

/** Contribution count → box height. sqrt compression keeps a single 200-commit
 *  day from dwarfing an entire year of steady 5-commit days. */
export function heightFor(count, max, {unitH}) {
  if (count <= 0)
    return 0
  const safeMax = Math.max(max, 1)
  return unitH * (1 + 7 * Math.sqrt(count / safeMax))
}

/** Bounding box of the whole grid including the tallest possible box. */
export function gridBounds({cols, rows, maxHeight}, geo) {
  const corners = [
    isoPoint(0, 0, maxHeight, geo),
    isoPoint(cols, 0, maxHeight, geo),
    isoPoint(cols, rows, 0, geo),
    isoPoint(0, rows, 0, geo),
    isoPoint(0, 0, 0, geo),
  ]
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return {minX, minY, width: maxX - minX, height: maxY - minY}
}
