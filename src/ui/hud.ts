import { ClassificationCategory, ClassificationResult } from '../types';

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

  // Draw active scanning laser animation across viewport
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

    const grad = this.ctx.createLinearGradient(0, this.scanLineY - 24, 0, this.scanLineY + 24);
    grad.addColorStop(0, 'rgba(14, 165, 233, 0)');
    grad.addColorStop(0.5, 'rgba(14, 165, 233, 0.22)');
    grad.addColorStop(1, 'rgba(14, 165, 233, 0)');

    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, this.scanLineY - 24, w, 48);

    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.scanLineY);
    this.ctx.lineTo(w, this.scanLineY);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Draw cyber corner target brackets to give the user a clear framing guide without bounding boxes
  public drawViewfinderBrackets(isHighlighted: boolean = false) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    const margin = Math.min(w, h) * 0.12;
    const bracketLen = 28;
    const x1 = margin;
    const y1 = margin;
    const x2 = w - margin;
    const y2 = h - margin;

    this.ctx.save();
    this.ctx.strokeStyle = isHighlighted ? '#10b981' : 'rgba(255, 255, 255, 0.4)';
    this.ctx.lineWidth = isHighlighted ? 3.5 : 2;
    this.ctx.shadowColor = isHighlighted ? 'rgba(16, 185, 129, 0.8)' : 'transparent';
    this.ctx.shadowBlur = isHighlighted ? 12 : 0;

    this.ctx.beginPath();
    // Top-left
    this.ctx.moveTo(x1, y1 + bracketLen);
    this.ctx.lineTo(x1, y1);
    this.ctx.lineTo(x1 + bracketLen, y1);
    // Top-right
    this.ctx.moveTo(x2 - bracketLen, y1);
    this.ctx.lineTo(x2, y1);
    this.ctx.lineTo(x2, y1 + bracketLen);
    // Bottom-left
    this.ctx.moveTo(x1, y2 - bracketLen);
    this.ctx.lineTo(x1, y2);
    this.ctx.lineTo(x1 + bracketLen, y2);
    // Bottom-right
    this.ctx.moveTo(x2 - bracketLen, y2);
    this.ctx.lineTo(x2, y2);
    this.ctx.lineTo(x2, y2 - bracketLen);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Render on-canvas Classification HUD: status banner and confidence readouts (NO bounding boxes)
  public renderClassificationHUD(
    result: ClassificationResult,
    isPlasticBottle: boolean,
    confidencePct: number
  ) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    const ctx = this.ctx;
    ctx.save();

    // 1. Draw Viewfinder Frame Reticles
    this.drawViewfinderBrackets(isPlasticBottle);

    // 2. Detection Banner when Plastic Bottle is identified
    if (isPlasticBottle) {
      const bannerW = Math.min(320, w - 32);
      const bannerH = 46;
      const bannerX = (w - bannerW) / 2;
      const bannerY = 24;

      // Outer glow & emerald backdrop
      ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(6, 78, 59, 0.92)';
      ctx.beginPath();
      ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 12);
      ctx.fill();

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.shadowBlur = 0;

      // Banner text
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#6ee7b7';
      ctx.textAlign = 'center';
      ctx.fillText(`PLASTIC BOTTLE DETECTED`, bannerX + bannerW / 2, bannerY + 20);

      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`Confidence: ${confidencePct}%`, bannerX + bannerW / 2, bannerY + 37);
    }

    ctx.restore();
  }
}
