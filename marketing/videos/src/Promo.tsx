import React from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/GolosText';
import type { Promo, Scene } from './data';

const { fontFamily } = loadFont('normal', { weights: ['500', '700', '800'], subsets: ['latin', 'cyrillic'] });

/** The app's Liquid Glass wallpaper, so the video and the product look like one thing. */
const Wallpaper: React.FC<{ accent: string }> = ({ accent }) => (
  <AbsoluteFill style={{
    background: `radial-gradient(720px 620px at 0% 0%, #3b82f6 0%, rgba(59,130,246,0) 60%),
      radial-gradient(780px 620px at 100% 0%, #f472b6 0%, rgba(244,114,182,0) 55%),
      radial-gradient(980px 740px at 60% 115%, #22c55e 0%, rgba(34,197,94,0) 60%),
      radial-gradient(680px 600px at 45% 50%, #a78bfa 0%, rgba(167,139,250,0) 60%),
      linear-gradient(180deg, #bfd3f2 0%, #b7c9e6 100%)`,
  }}>
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${accent}22 0%, rgba(0,0,0,0) 40%, rgba(10,30,70,0.35) 100%)` }} />
  </AbsoluteFill>
);

const Ease = Easing.bezier(0.16, 1, 0.3, 1);
const up = (frame: number, from: number, dur: number) => ({
  opacity: interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Ease }),
  translate: `0px ${interpolate(frame, [from, from + dur], [60, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Ease })}px`,
});

/** First 2 s: one question, big, on the wallpaper. A quick scale-in so the thumb stops. */
const Hook: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 90px' }}>
      <div style={{
        fontFamily, fontWeight: 800, fontSize: 118, lineHeight: 1.05, color: '#0f172a', textAlign: 'center', letterSpacing: -2,
        scale: String(interpolate(frame, [0, 0.45 * fps], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1) })),
        opacity: interpolate(frame, [0, 0.2 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>{text}</div>
      {sub && <div style={{ fontFamily, fontWeight: 500, fontSize: 52, color: '#334155', marginTop: 40, textAlign: 'center', ...up(frame, 0.5 * fps, 0.5 * fps) }}>{sub}</div>}
    </AbsoluteFill>
  );
};

/** A phone or a laptop frame with the real screenshot inside; a slow drift keeps the eye moving. */
const Device: React.FC<{ scene: Scene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const focusY = scene.focus === 'bottom' ? '100%' : scene.focus === 'middle' ? '50%' : '0%';
  const enter = up(frame, 0, 0.6 * fps);
  if (scene.desktop) {
    return (
      <div style={{ position: 'absolute', left: 40, right: 40, top: 420, ...enter }}>
        <div style={{ borderRadius: 36, background: '#0f172a', padding: 18, boxShadow: '0 50px 120px -30px rgba(10,30,70,0.6)' }}>
          <div style={{ borderRadius: 22, overflow: 'hidden', aspectRatio: '1366 / 768', background: '#fff' }}>
            <Img src={staticFile(`shots/${scene.shot}.png`)} style={{
              width: '100%', display: 'block',
              scale: String(interpolate(frame, [0, durationInFrames], [1.35, 1.5], { extrapolateRight: 'clamp' })),
              transformOrigin: '28% 22%',
            }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', left: 160, top: 400, width: 760, ...enter }}>
      <div style={{ borderRadius: 86, background: '#0f172a', padding: 16, boxShadow: '0 50px 120px -30px rgba(10,30,70,0.6)' }}>
        <div style={{ borderRadius: 72, overflow: 'hidden', height: 1100, background: '#fff', position: 'relative' }}>
          <Img src={staticFile(`shots/${scene.shot}.png`)} style={{
            width: '100%', display: 'block', position: 'absolute', left: 0, top: 0,
            translate: `0px ${interpolate(frame, [0, durationInFrames], [0, scene.focus === 'bottom' ? -420 : scene.focus === 'middle' ? -220 : -90], { extrapolateRight: 'clamp' })}px`,
            transformOrigin: `50% ${focusY}`,
          }} />
        </div>
      </div>
    </div>
  );
};

const Title: React.FC<{ title: string; sub?: string; accent: string }> = ({ title, sub, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, top: 110, ...up(frame, 0.15 * fps, 0.5 * fps) }}>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 64, lineHeight: 1.08, color: '#0f172a', letterSpacing: -1 }}>{title}</div>
      {sub && <div style={{ fontFamily, fontWeight: 600, fontSize: 38, color: accent, marginTop: 12 }}>{sub}</div>}
    </div>
  );
};

/** Sentence captions from the voice timing: glass capsule at the bottom, one sentence at a time. */
const Captions: React.FC<{ cues: Promo['voice']['cues'] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end + 0.25);
  if (!cue) return null;
  // a long sentence is shown in pieces (split at commas/colons), each piece for its share of the sentence's time
  const parts = cue.text.length > 70 ? cue.text.split(/(?<=[,:;])\s+/) : [cue.text];
  const total = parts.reduce((n, p) => n + p.length, 0);
  let acc = 0, idx = 0, partStart = cue.start;
  const span = cue.end - cue.start;
  for (let i = 0; i < parts.length; i++) {
    const ps = cue.start + (acc / total) * span; acc += parts[i].length; const pe = cue.start + (acc / total) * span;
    if (t >= ps && (t < pe || i === parts.length - 1)) { idx = i; partStart = ps; break; }
  }
  const text = parts[idx];
  const from = partStart * fps;
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, bottom: 150, display: 'flex', justifyContent: 'center' }}>
      <div style={{
        fontFamily, fontWeight: 700, fontSize: 46, lineHeight: 1.25, color: '#fff', textAlign: 'center', padding: '22px 34px', borderRadius: 36,
        background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(16px)', boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.35)',
        opacity: interpolate(frame, [from, from + 0.25 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        translate: `0px ${interpolate(frame, [from, from + 0.3 * fps], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Ease })}px`,
      }}>{text}</div>
    </div>
  );
};

const Compare: React.FC<{ rows: NonNullable<Promo['compare']>; accent: string }> = ({ rows, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 80px', gap: 36 }}>
      {rows.map((r, i) => (
        <div key={r.name} style={{
          borderRadius: 44, padding: '42px 46px', background: r.tone === 'brand' ? accent : 'rgba(255,255,255,0.78)',
          boxShadow: r.tone === 'brand' ? '0 30px 60px -20px rgba(10,30,70,0.6)' : '0 10px 30px -18px rgba(15,23,42,0.25)',
          ...up(frame, (0.3 + i * 0.9) * fps, 0.6 * fps),
          scale: r.tone === 'brand' ? String(interpolate(frame, [(0.3 + i * 0.9) * fps, (0.9 + i * 0.9) * fps], [0.92, 1.04], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1) })) : '1',
        }}>
          <div style={{ fontFamily, fontWeight: 800, fontSize: 64, color: r.tone === 'brand' ? '#fff' : '#0f172a' }}>{r.name}</div>
          <div style={{ fontFamily, fontWeight: 500, fontSize: 40, color: r.tone === 'brand' ? 'rgba(255,255,255,0.92)' : '#475569', marginTop: 8, lineHeight: 1.25 }}>{r.what}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ cta: string; accent: string }> = ({ cta, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 90px' }}>
      <div style={{ width: 300, height: 300, borderRadius: 84, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 60px -20px rgba(10,30,70,0.5)',
        scale: String(interpolate(frame, [0, 0.5 * fps], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1), output: 'perceptual-scale' })) }}>
        <Img src={staticFile('brand/mark.png')} style={{ width: 230 }} />
      </div>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 110, marginTop: 50, letterSpacing: -2, ...up(frame, 0.3 * fps, 0.5 * fps) }}>
        <span style={{ color: '#00226d' }}>Med.uz</span><span style={{ color: '#2f86cf' }}>.ai</span>
      </div>
      <div style={{ fontFamily, fontWeight: 600, fontSize: 46, color: '#1e293b', marginTop: 20, textAlign: 'center', lineHeight: 1.3, ...up(frame, 0.6 * fps, 0.5 * fps) }}>{cta}</div>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 54, color: '#fff', background: accent, padding: '26px 60px', borderRadius: 999, marginTop: 60, boxShadow: '0 20px 40px -14px rgba(10,30,70,0.6)', ...up(frame, 0.9 * fps, 0.5 * fps) }}>Bepul demo → med.uz.ai</div>
    </AbsoluteFill>
  );
};

/** hook (first cue) → compare rows (only «nega») → one scene per voice sentence → end card (last cue). */
export const PromoVideo: React.FC<{ promo: Promo }> = ({ promo }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const cues = promo.voice.cues;
  const hookEnd = Math.round(cues[0].end * fps);
  const endStart = Math.round(cues[cues.length - 1].start * fps);
  // the middle sentences map onto the scenes in order; the compare block (if any) takes the sentences before the scenes
  const compareCount = promo.compare ? promo.compareCues ?? 2 : 0;
  const scenesStart = compareCount ? Math.round(cues[compareCount].end * fps) : hookEnd;
  const slot = (endStart - scenesStart) / promo.scenes.length;
  return (
    <AbsoluteFill style={{ fontFamily }}>
      <Wallpaper accent={promo.accent} />
      <Audio src={staticFile(`audio/${promo.id}.mp3`)} />
      <Sequence name="Hook" durationInFrames={hookEnd}><Hook text={promo.hook} sub={promo.hookSub} /></Sequence>
      {promo.compare && compareCount > 0 && (
        <Sequence name="Compare" from={hookEnd} durationInFrames={scenesStart - hookEnd}>
          <Compare rows={promo.compare} accent={promo.accent} />
        </Sequence>
      )}
      {promo.scenes.map((scene, i) => {
        const from = Math.round(scenesStart + i * slot);
        const to = i === promo.scenes.length - 1 ? endStart : Math.round(scenesStart + (i + 1) * slot);
        return (
          <Sequence key={scene.shot + i} name={`Scene ${i + 1}`} from={from} durationInFrames={Math.max(1, to - from)}>
            <Device scene={scene} durationInFrames={to - from} />
            <Title title={scene.title} sub={scene.sub} accent={promo.accent} />
          </Sequence>
        );
      })}
      <Sequence name="End" from={endStart} durationInFrames={durationInFrames - endStart}><EndCard cta={promo.cta} accent={promo.accent} /></Sequence>
      <Captions cues={cues.slice(0, -1)} />
    </AbsoluteFill>
  );
};
