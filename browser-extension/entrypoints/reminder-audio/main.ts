import { browser } from 'wxt/browser';

let context: AudioContext | undefined;
let playing = false;
browser.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== browser.runtime.id || message?.type !== 'alchemy:reminder-audio') return;
  void (async () => {
    if (playing) return;
    const { tone, volume } = message.preferences || {};
    if (!['soft', 'bell'].includes(tone) || !Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error('无效提示音');
    playing = true;
    try {
      context ||= new AudioContext();
      await context.resume();
      if (context.state !== 'running') throw new Error('浏览器阻止了声音播放，请在设置中重试试听。');
      const oscillator = context.createOscillator(), gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(tone === 'bell' ? 784 : 523.25, now);
      oscillator.frequency.exponentialRampToValueAtTime(tone === 'bell' ? 659.25 : 440, now + .45);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume / 100 * .15, now + .03);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .65);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + .7);
      await new Promise<void>(resolve => { oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); resolve(); }; });
    } finally { playing = false; }
  })().then(() => reply({ ok: true }), error => reply({ error: error.message }));
  return true;
});
