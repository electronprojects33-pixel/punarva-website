import { DetectedBottle } from '../types';

export class HudRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scanLineY: number = 0;
  private scanDirection: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to obtain 2D canvas context for HUD');
    }
    this.ctx = context;
  }

  public syncSize(videoEl: HTMLVideoElement) {
    const rect = videoEl.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  public clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Draw active scanning laser animation
  public drawScanningGuide(isScanning: boolean) {
    if (!isScanning) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    this.ctx.save();

    this.scanLineY += 3.5 * this.scanDirection;
    if (this.scanLineY > h) {
      this.scanLineY = h;
      this.scanDirection = -1;
    } else if (this.scanLineY < 0) {
      this.scanLineY = 0;
      this.scanDirection = 1;
    }

    const grad = this.ctx.createLinearGradient(0, this.scanLineY - 20, 0, this.scanLineY + 20);
    grad.addColorStop(0, 'rgba(14, 165, 233, 0)');
    grad.addColorStop(0.5, 'rgba(14, 165, 233, 0.25)');
    grad.addColorStop(1, 'rgba(14, 165, 233, 0)');

    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, this.scanLineY - 20, w, 40);

    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.scanLineY);
    this.ctx.lineTo(w, this.scanLineY);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Render multiple dynamic bounding boxes around detected bottles
  public renderDetections(
    bottles: DetectedBottle[],
    videoEl: HTMLVideoElement
  ) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    if (cw === 0 || ch === 0 || vw === 0 || vh === 0) return;

    // Calculate object-fit: cover scaling and letterbox offsets
    const canvasAspect = cw / ch;
    const videoAspect = vw / vh;

    let renderW = cw;
    let renderH = ch;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasAspect > videoAspect) {
      renderH = cw / videoAspect;
      offsetY = (ch - renderH) / 2;
    } else {
      renderW = ch * videoAspect;
      offsetX = (cw - renderW) / 2;
    }

    const scaleX = renderW / vw;
    const scaleY = renderH / vh;

    // 1. Draw individual bounding box for every bottle
    for (const bottle of bottles) {
      const { originX, originY, width, height } = bottle.boundingBox;
      
      const x = Math.round((originX * scaleX) + offsetX);
      const y = Math.round((originY * scaleY) + offsetY);
      const w = Math.round(width * scaleX);
      const h = Math.round(height * scaleY);

      const scorePct = Math.round(bottle.score * 100);

      ctx.save();

      // Translucent emerald fill
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fillRect(x, y, w, h);

      // Glowing border
      ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      // Cyber corner brackets
      const cornerSize = Math.max(10, Math.min(w, h) * 0.22);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(x, y + cornerSize);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cornerSize, y);
      // Top-right
      ctx.moveTo(x + w - cornerSize, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerSize);
      // Bottom-left
      ctx.moveTo(x, y + h - cornerSize);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cornerSize, y + h);
      // Bottom-right
      ctx.moveTo(x + w - cornerSize, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y + h - cornerSize);
      ctx.stroke();

      // Center crosshair
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();

      // Label Tag Badge
      const labelText = `PLASTIC BOTTLE ${scorePct}%`;
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      const textMetrics = ctx.measureText(labelText);
      const badgeW = textMetrics.width + 16;
      const badgeH = 22;
      const badgeY = Math.max(8, y - badgeH - 3);

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.roundRect(x, badgeY, badgeW, badgeH, 4);
      ctx.fill();

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(labelText, x + 8, badgeY + 15);

      ctx.restore();
    }

    // 2. Multiple Bottles Found Pill (top-left)
    if (bottles.length > 0) {
      ctx.save();
      const countText = `DETECTED: ${bottles.length} ${bottles.length === 1 ? 'BOTTLE' : 'BOTTLES'}`;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      const metric = ctx.measureText(countText);
      const pillW = metric.width + 20;

      ctx.fillStyle = 'rgba(6, 78, 59, 0.9)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(14, 14, pillW, 28, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.fillText(countText, 24, 32);
      ctx.restore();
    }
  }
}
