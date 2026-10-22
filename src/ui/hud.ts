import { ClassificationCategory } from '../types';

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

  public syncSize(videoWidth: number, videoHeight: number) {
    if (this.canvas.width !== videoWidth || this.canvas.height !== videoHeight) {
      this.canvas.width = videoWidth;
      this.canvas.height = videoHeight;
    }
  }

  public clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Draw active scanning radar animation and central sorting reticle
  public drawScanningGuide(isScanning: boolean) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    this.ctx.save();

    // Central Viewfinder / Sorter Zone Brackets
    const boxSize = Math.min(w, h) * 0.6;
    const boxX = (w - boxSize) / 2;
    const boxY = (h - boxSize) / 2;
    const bracketLen = boxSize * 0.15;

    this.ctx.strokeStyle = isScanning ? 'rgba(14, 165, 233, 0.7)' : 'rgba(100, 116, 139, 0.4)';
    this.ctx.lineWidth = 3;

    // Corner brackets
    // Top-left
    this.ctx.beginPath();
    this.ctx.moveTo(boxX, boxY + bracketLen);
    this.ctx.lineTo(boxX, boxY);
    this.ctx.lineTo(boxX + bracketLen, boxY);
    // Top-right
    this.ctx.moveTo(boxX + boxSize - bracketLen, boxY);
    this.ctx.lineTo(boxX + boxSize, boxY);
    this.ctx.lineTo(boxX + boxSize, boxY + bracketLen);
    // Bottom-left
    this.ctx.moveTo(boxX, boxY + boxSize - bracketLen);
    this.ctx.lineTo(boxX, boxY + boxSize);
    this.ctx.lineTo(boxX + bracketLen, boxY + boxSize);
    // Bottom-right
    this.ctx.moveTo(boxX + boxSize - bracketLen, boxY + boxSize);
    this.ctx.lineTo(boxX + boxSize, boxY + boxSize);
    this.ctx.lineTo(boxX + boxSize, boxY + boxSize - bracketLen);
    this.ctx.stroke();

    // Subtle center crosshairs
    const cx = w / 2;
    const cy = h / 2;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 14, cy);
    this.ctx.lineTo(cx + 14, cy);
    this.ctx.moveTo(cx, cy - 14);
    this.ctx.lineTo(cx, cy + 14);
    this.ctx.stroke();

    // Moving laser scanline when actively classifying
    if (isScanning) {
      this.scanLineY += 4 * this.scanDirection;
      if (this.scanLineY > boxY + boxSize) {
        this.scanLineY = boxY + boxSize;
        this.scanDirection = -1;
      } else if (this.scanLineY < boxY) {
        this.scanLineY = boxY;
        this.scanDirection = 1;
      }

      const grad = this.ctx.createLinearGradient(0, this.scanLineY - 24, 0, this.scanLineY + 24);
      grad.addColorStop(0, 'rgba(14, 165, 233, 0)');
      grad.addColorStop(0.5, 'rgba(14, 165, 233, 0.35)');
      grad.addColorStop(1, 'rgba(14, 165, 233, 0)');

      this.ctx.fillStyle = grad;
      this.ctx.fillRect(boxX, this.scanLineY - 24, boxSize, 48);

      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(boxX, this.scanLineY);
      this.ctx.lineTo(boxX + boxSize, this.scanLineY);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  // Render classification probability meters and status banner
  public renderClassification(
    categories: ClassificationCategory[],
    topCategory: ClassificationCategory,
    isTargetTriggered: boolean,
    targetName: string
  ) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    ctx.save();

    // 1. Live Probability Gauges Panel (Top Left)
    const panelX = 14;
    const panelY = 14;
    const panelW = 240;
    const rowH = 26;
    const panelH = (categories.length * rowH) + 32;

    ctx.fillStyle = 'rgba(11, 19, 41, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 10);
    ctx.fill();
    ctx.stroke();

    // Panel Header
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText('LIVE AI CLASSIFICATION', panelX + 12, panelY + 18);

    // Bars for each class
    categories.forEach((cat, idx) => {
      const y = panelY + 30 + (idx * rowH);
      const isTarget = cat.categoryName.toLowerCase().includes('bottle') || 
                       cat.categoryName.toLowerCase() === targetName.toLowerCase();
      const pct = Math.round(cat.score * 100);

      // Label
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = isTarget ? '#34d399' : '#cbd5e1';
      const label = cat.categoryName.replace(/_/g, ' ');
      ctx.fillText(label, panelX + 12, y + 12);

      // Percentage text
      ctx.textAlign = 'right';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText(`${pct}%`, panelX + panelW - 12, y + 12);
      ctx.textAlign = 'left';

      // Bar background track
      const barX = panelX + 12;
      const barY = y + 16;
      const barW = panelW - 24;
      const barH = 5;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 2.5);
      ctx.fill();

      // Filled Progress Bar
      const fillW = Math.max(2, (barW * cat.score));
      ctx.fillStyle = isTarget ? '#10b981' : '#64748b';
      ctx.beginPath();
      ctx.roundRect(barX, barY, fillW, barH, 2.5);
      ctx.fill();
    });

    // 2. Large Detection Banner when Target is Locked (e.g. Plastic Bottle >= threshold)
    if (isTargetTriggered) {
      const bannerW = Math.min(380, w - 40);
      const bannerH = 46;
      const bannerX = (w - bannerW) / 2;
      const bannerY = h - bannerH - 24;

      ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
      ctx.shadowBlur = 20;

      // Banner background
      ctx.fillStyle = 'rgba(6, 78, 59, 0.95)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 12);
      ctx.fill();
      ctx.stroke();

      // Banner text
      ctx.shadowBlur = 0;
      ctx.font = 'bold 15px "Outfit", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      const pct = Math.round(topCategory.score * 100);
      ctx.fillText(`✓ PLASTIC BOTTLE DETECTED (${pct}%)`, w / 2, bannerY + 28);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }
}
