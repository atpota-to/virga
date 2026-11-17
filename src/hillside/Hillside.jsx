// The hillside behind the app: a 3D green hill under a blue sky (scene.js),
// loaded on demand. Until it's up, or where WebGL isn't there, a flat picture
// of the same sky and field stands in for it.
//
// The page says where the hill's crest goes by setting --crest on this or an
// ancestor (a length from the top, so it can follow the page's own layout and
// breakpoints). `phase` is the sky: 'dawn', 'day', 'dusk' or 'night' (lib/sky.js
// chooses it from the settings); the scene eases from whichever it is showing
// to the next. `day` is the older way to ask, kept for the front page: under
// a half is dawn, the rest is day. While `active` is
// false it keeps its last picture and stops drawing, for when the page has it
// covered. `intro` brings the view down from the sky onto the hill when it
// first appears. `depth` is how deep a blue the sky gets at the top: 1 is the
// full deep blue, less is paler, for a page with a lot of words on its sky.
//
// It sits out of focus behind the page, the way a landscape does when your
// eye is on something close: `soft` (on by default) blurs it by --hill-blur.
// It arrives sharp and the focus moves to the page a moment later.
//
// Ported from the Open Social site (opensocial.group), where it is the sky
// behind the Thread and Daylight directions.

import { useEffect, useRef, useState } from 'react';
import { SKY_PHASES } from '../lib/sky.js';
import './hillside.css';

export default function Hillside({
  phase = null,
  day = 1,
  active = true,
  intro = false,
  depth = 1,
  soft = true,
  className = '',
}) {
  const sky = SKY_PHASES.includes(phase) ? phase : day < 0.5 ? 'dawn' : 'day';
  const hostRef = useRef(null);
  const crestRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const want = useRef({ sky, active, intro, depth, soft, inView: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const crest = crestRef.current;
    const canvas = canvasRef.current;
    if (!host || !crest || !canvas) return undefined;
    let gone = false;
    let scene = null;
    let ro = null;
    let io = null;
    let idle = 0;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = async () => {
      const { createHillside } = await import('./scene.js');
      if (gone) return;
      scene = createHillside(canvas, {
        calm,
        phase: want.current.sky,
        depth: want.current.depth,
        soft: want.current.soft,
        onReady: () => setReady(true),
        onLost: () => setReady(false),
      });
      if (!scene) return;
      sceneRef.current = scene;
      const s = scene;
      // The canvas runs a little past the edges, so its blur doesn't fade out
      // at them; the crest is measured on the page, so it's moved into the
      // canvas's own terms.
      const fit = () =>
        s.resize(
          canvas.clientWidth,
          canvas.clientHeight,
          (crest.offsetHeight - canvas.offsetTop) / (canvas.clientHeight || 1),
        );
      s.setActive(want.current.active && want.current.inView);
      if (want.current.intro) s.intro();
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(host);
      ro.observe(crest);
      ro.observe(canvas);
      io = new IntersectionObserver(([e]) => {
        want.current.inView = e.isIntersecting;
        s.setActive(want.current.active && want.current.inView);
      });
      io.observe(host);
    };

    // Shown now: start now. Covered for the moment: start when the page is idle.
    if (want.current.active) start();
    else {
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(() => start(), { timeout: 2500 })
        : window.setTimeout(() => start(), 1200);
    }

    return () => {
      gone = true;
      if (idle) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
        window.clearTimeout(idle);
      }
      ro?.disconnect();
      io?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    want.current.sky = sky;
    sceneRef.current?.setPhase(sky);
  }, [sky]);

  useEffect(() => {
    want.current.active = active;
    sceneRef.current?.setActive(active && want.current.inView);
  }, [active]);

  return (
    <div
      ref={hostRef}
      className={`hillside ${className}`.trim()}
      data-ready={ready || undefined}
      data-soft={(soft && ready && active) || undefined}
      data-phase={sky}
      aria-hidden="true"
    >
      <div ref={crestRef} className="hillside-crest" />
      <canvas ref={canvasRef} className="hillside-canvas" />
    </div>
  );
}
