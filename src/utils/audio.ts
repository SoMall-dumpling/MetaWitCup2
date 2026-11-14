/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SoundController {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  /** 预热 AudioContext：首次用户交互时调用，后续音效零延迟播放 */
  public warmup() {
    this.readyCtx().catch(() => {});
  }

  /** 返回可用的 AudioContext；处于挂起状态时先异步等待恢复完成再返回。
   * 之前的实现 fire-and-forget 调用 resume()，振荡器按冻结的 currentTime
   * 调度，声音要等恢复真正完成后才响——恢复慢时就是几百毫秒的延迟 */
  private async readyCtx(): Promise<AudioContext | null> {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // 恢复失败（如无用户手势）：保持挂起，本次不出声
      }
    }
    return this.ctx;
  }

  public playStart() {
    if (!this.enabled) return;
    this.readyCtx().then((ctx) => {
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.15);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playTick(pitchMultiplier: number = 1.0) {
    if (!this.enabled) return;
    this.readyCtx().then((ctx) => {
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480 * pitchMultiplier, t);
      osc.frequency.exponentialRampToValueAtTime(260 * pitchMultiplier, t + 0.05);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.06);
    });
  }

  public playDot() {
    if (!this.enabled) return;
    this.readyCtx().then((ctx) => {
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1174, t + 0.12);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  public playBacktrack() {
    // Backtrack audio removed per user request
  }

  public playSuccess() {
    if (!this.enabled) return;
    this.readyCtx().then((ctx) => {
      if (!ctx) return;

      const notes = [440, 554.37, 659.25, 880]; // A major arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + idx * 0.08;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.14, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.6);
      });
    });
  }

  public playFailure() {
    if (!this.enabled) return;
    this.readyCtx().then((ctx) => {
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.linearRampToValueAtTime(110, t + 0.25);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.3);
    });
  }
}

export const sound = new SoundController();

// 首次用户交互（任意点击/按键）即预热 AudioContext：
// 浏览器要求用户手势后才允许发声，预热后 playStart / playSuccess /
// playFailure 等不再经历创建与恢复的延迟，实现零延迟播放
if (typeof window !== 'undefined') {
  const warmup = () => sound.warmup();
  window.addEventListener('pointerdown', warmup, { once: true, passive: true });
  window.addEventListener('keydown', warmup, { once: true, passive: true });
}
