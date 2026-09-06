/* La Silla Vacía — v2 "Se sientan".
   Cada silla se arma de abajo hacia arriba y las tres se acercan hasta su sitio.
   Geometría vectorizada del PNG original (0,3% de desviación). */
const { useComposition, animate, Easing } = window;

const P0 = "M349 1 L512 38 L512 408 L489 408 L489 262 L376 288 L373 289 L373 443 L349 443 L349 289 L239 263 L234 263 L234 275 L210 270 L210 233 L349 201 Z M374 146 L373 201 L489 228 L489 172 Z";
const P1 = "M1 70 L164 108 L164 512 L140 512 L140 269 L30 243 L24 242 L24 298 L129 274 L129 356 L24 332 L24 478 L0 478 Z";
const P2 = "M175 274 L303 303 L303 478 L280 478 L280 332 L175 356 Z";
const P3 = "M228 355 L234 355 L234 408 L210 408 L210 360 Z";

const CLIPS = {
  back0: "195,-30 525,-30 525,218 349,193 195,225",
  seat0: "195,225 349,193 525,218 525,270 376,294 349,294 241,268 238,280 195,282",
  legs0: "195,282 238,280 241,268 349,294 376,294 525,270 525,540 195,540",
  back1: "-20,-30 170,-30 170,268 -20,239",
  seat1: "-20,239 170,268 170,364 129,357 -20,330",
  legs1: "-20,330 129,357 170,364 170,540 -20,540",
  beam2: "160,250 320,292 320,338 280,334 165,362",
  legs2: "165,362 280,334 320,338 320,540 165,540",
};

// Cada silla: retardo de entrada, desplazamiento del que se acerca, y su sombra de contacto.
const CHAIRS = [
  {
    id: "grande", delay: 0.05, from: [100, 0], shadow: { x: 84, y: 85, w: 30, h: 2.8 },
    pieces: [
      { id: "legs0", ds: [P0], clip: "legs0", origin: "84% 72%", rise: [0, 110], t: 0.00 },
      { id: "seat0", ds: [P0], clip: "seat0", origin: "68% 48%", rise: [0, -80], t: 0.16, land: true },
      { id: "back0", ds: [P0], clip: "back0", origin: "84% 25%", rise: [0, -190], t: 0.32 },
    ],
  },
  {
    id: "izquierda", delay: 0.72, from: [-100, 0], shadow: { x: 16, y: 92, w: 30, h: 2.8 },
    pieces: [
      { id: "legs1", ds: [P1], clip: "legs1", origin: "16% 84%", rise: [0, 120], t: 0.00 },
      { id: "seat1", ds: [P1], clip: "seat1", origin: "15% 59%", rise: [0, -70], t: 0.16, land: true },
      { id: "back1", ds: [P1], clip: "back1", origin: "16% 33%", rise: [0, -200], t: 0.32 },
    ],
  },
  {
    id: "pequena", delay: 1.34, from: [26, 60], shadow: { x: 47, y: 92, w: 23, h: 2.4 },
    pieces: [
      { id: "legs2", ds: [P2, P3], clip: "legs2", origin: "49% 82%", rise: [0, 90], t: 0.00 },
      { id: "beam2", ds: [P2], clip: "beam2", origin: "47% 61%", rise: [0, -60], t: 0.16, land: true },
    ],
  },
];

const MOTION = {
  drift: (o) => animate({ ...o, ease: Easing.easeInOutCubic }),
  click: (o) => animate({ ...o, ease: Easing.easeOutBack }),
  fade: (o) => animate({ ...o, ease: Easing.easeOutQuad }),
};

const DUR = 0.55;

function Piece({ p, T, start, color }) {
  const k = MOTION.click({ from: 0, to: 1, start, end: start + DUR })(T);
  const o = MOTION.fade({ from: 0, to: 1, start, end: start + 0.14 })(T);
  const q = 1 - k;
  // el asiento aterriza: se achata un instante al tocar las patas
  const sq = p.land ? 1 + 0.09 * Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.35)) * (k > 0.55 ? 1 : 0.35)) : 1;
  const cid = "v2-" + p.id;
  return (
    <div style={{
      position: "absolute", inset: 0, opacity: o, transformOrigin: p.origin,
      transform: `translate3d(${q * p.rise[0]}px,${q * p.rise[1]}px,0) scale(${1 / sq},${sq})`,
    }}>
      <svg viewBox="0 0 512 512" width="100%" height="100%" style={{ display: "block" }}>
        <defs><clipPath id={cid}><polygon points={CLIPS[p.clip]} /></clipPath></defs>
        <g clipPath={`url(#${cid})`}>
          {p.ds.map((d, i) => <path key={i} d={d} fill={color} />)}
        </g>
      </svg>
    </div>
  );
}

function Chair({ c, T, cues, color, color2, spread, shadow }) {
  const base = cues.Primera + c.delay;
  const built = MOTION.fade({ from: 0, to: 1, start: base, end: base + 0.5 + DUR })(T);
  const join = MOTION.drift({ from: 1, to: 0, start: base + 0.5, end: cues.Silencio + 0.3 })(T);
  const gx = join * c.from[0] * spread;
  const gy = join * c.from[1] * spread;
  const s = c.shadow;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `translate3d(${gx}px,${gy}px,0)` }}>
      {shadow ? (
        <div style={{
          position: "absolute", left: s.x + "%", top: s.y + "%",
          width: s.w + "%", height: s.h + "%", transform: "translate(-50%,0)",
          borderRadius: "50%", background: color2, opacity: 0.1 * built,
          filter: "blur(6px)",
        }}></div>
      ) : null}
      {c.pieces.map((p) => (
        <Piece key={p.id} p={p} T={T} start={base + p.t} color={color} />
      ))}
    </div>
  );
}

function LogoAssembly({ tweaks }) {
  const { T, CUES } = useComposition();
  const color = (tweaks && tweaks.accent) || "#338BFD";
  const spread = (tweaks && tweaks.spread != null ? tweaks.spread : 100) / 100;
  const shadow = !tweaks || tweaks.shadow !== false;

  const zoom = MOTION.fade({ from: 1.06, to: 1, start: 0, end: 2.7 })(T);
  const settle = MOTION.click({ from: 0.99, to: 1, start: CUES.Silencio - 0.1, end: CUES.Silencio + 0.45 })(T);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#ffffff", display: "grid", placeItems: "center", overflow: "hidden" }}>
      <div style={{ width: 720, height: 720, position: "relative", transform: `scale(${zoom * settle})` }}>
        {CHAIRS.map((c) => (
          <Chair key={c.id} c={c} T={T} cues={CUES} color={color} color2="#0B1F3A" spread={spread} shadow={shadow} />
        ))}
      </div>
    </div>
  );
}

window.LogoAssembly2 = LogoAssembly;

function LogoVideo2() {
  const { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakColor, TweakSlider, CompositionStage } = window;
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <React.Fragment>
      <CompositionStage width={1080} height={1080} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK} bg="#ffffff">
        <LogoAssembly tweaks={t} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Animación" />
        <TweakSlider label="Distancia de llegada" value={t.spread} min={40} max={160} step={5} unit="%" onChange={(v) => setTweak('spread', v)} />
        <TweakToggle label="Sombra de contacto" value={t.shadow} onChange={(v) => setTweak('shadow', v)} />
        <TweakSection label="Marca" />
        <TweakColor label="Color" value={t.accent} options={['#338BFD', '#0B1F3A', '#111111', '#E23A2E']} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}
window.LogoVideo2 = LogoVideo2;
