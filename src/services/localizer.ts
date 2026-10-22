import { BoundingBox } from '../types';

export class ObjectLocalizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 160;
  private height: number = 120;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Failed to get 2d context for localizer');
    }
    this.ctx = context;
  }

  // Locates candidate object bounding boxes in real-time (< 2ms)
  public findObjectBoxes(video: HTMLVideoElement): BoundingBox[] {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return [];

    // Draw downsampled frame to offscreen canvas
    this.ctx.drawImage(video, 0, 0, this.width, this.height);
    const imgData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imgData.data;

    // Compute average background color from edges
    let rSum = 0, gSum = 0, bSum = 0, edgeCount = 0;
    const w = this.width;
    const h = this.height;

    for (let x = 0; x < w; x += 4) {
      // Top edge
      let idx = (x) * 4;
      rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2];
      // Bottom edge
      idx = ((h - 1) * w + x) * 4;
      rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2];
      edgeCount += 2;
    }

    const bgR = rSum / Math.max(1, edgeCount);
    const bgG = gSum / Math.max(1, edgeCount);
    const bgB = bSum / Math.max(1, edgeCount);

    // Simple grid accumulation to locate foreground clusters
    const gridCols = 16;
    const gridRows = 12;
    const cellW = w / gridCols;
    const cellH = h / gridRows;
    const grid: number[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(0));

    for (let y = 4; y < h - 4; y += 2) {
      for (let x = 4; x < w - 4; x += 2) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Deviation from background
        const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
        if (diff > 45) {
          const col = Math.floor(x / cellW);
          const row = Math.floor(y / cellH);
          if (row < gridRows && col < gridCols) {
            grid[row][col]++;
          }
        }
      }
    }

    // Find connected active cells in the grid
    const minThreshold = (cellW * cellH) * 0.12;
    const candidateBoxes: BoundingBox[] = [];
    const visited: boolean[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(false));

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (!visited[r][c] && grid[r][c] > minThreshold) {
          // Flood fill to find cluster bounds
          let minR = r, maxR = r, minC = c, maxC = c;
          const queue: [number, number][] = [[r, c]];
          visited[r][c] = true;

          while (queue.length > 0) {
            const [currR, currC] = queue.pop()!;
            minR = Math.min(minR, currR);
            maxR = Math.max(maxR, currR);
            minC = Math.min(minC, currC);
            maxC = Math.max(maxC, currC);

            // Check 4-connected neighbors
            const neighbors: [number, number][] = [
              [currR - 1, currC],
              [currR + 1, currC],
              [currR, currC - 1],
              [currR, currC + 1]
            ];

            for (const [nr, nc] of neighbors) {
              if (nr >= 0 && nr < gridRows && nc >= 0 && nc < gridCols) {
                if (!visited[nr][nc] && grid[nr][nc] > minThreshold) {
                  visited[nr][nc] = true;
                  queue.push([nr, nc]);
                }
              }
            }
          }

          // Calculate box in video coordinates
          const boxW_norm = (maxC - minC + 1) / gridCols;
          const boxH_norm = (maxR - minR + 1) / gridRows;

          // Reject noise or whole screen flashes
          if (boxW_norm >= 0.1 && boxH_norm >= 0.12 && boxW_norm <= 0.95 && boxH_norm <= 0.95) {
            const originX = Math.round((minC / gridCols) * vw);
            const originY = Math.round((minR / gridRows) * vh);
            const width = Math.round(boxW_norm * vw);
            const height = Math.round(boxH_norm * vh);

            candidateBoxes.push({ originX, originY, width, height });
          }
        }
      }
    }

    // If clusters are detected, return them
    if (candidateBoxes.length > 0) {
      return candidateBoxes.slice(0, 4);
    }

    // Fallback: If bottle fills center or low contrast, provide tight center-viewfinder box
    return [
      {
        originX: Math.round(vw * 0.22),
        originY: Math.round(vh * 0.15),
        width: Math.round(vw * 0.56),
        height: Math.round(vh * 0.70)
      }
    ];
  }
}

export const objectLocalizer = new ObjectLocalizer();
