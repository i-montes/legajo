/* La Silla Vacía — las piezas están en el suelo y se levantan hasta armar el logo.
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

// floor = desplazamiento (px) desde su sitio final hasta el suelo; rz = giro tumbado;
// ry = giro que corrige al encajar; t = orden en que se levanta.
const PIECES = [
  { id: "back1", ds: [P1], clip: "back1", origin: "16% 33%", floor: [-5, 381], rz: -22, ry: -28, t: 0.00 },
  { id: "seat1", ds: [P1], clip: "seat1", origin: "15% 59%", floor: [145, 58], rz: 14, ry: 22, t: 0.13 },
  { id: "legs1", ds: [P1], clip: "legs1", origin: "16% 84%", floor: [-20, -85], rz: -8, ry: -16, t: 0.26 },
  { id: "back0", ds: [P0], clip: "back0", origin: "84% 25%", floor: [15, 457], rz: 25, ry: 30, t: 0.39 },
  { id: "seat0", ds: [P0], clip: "seat0", origin: "68% 48%", floor: [-62, 247], rz: -16, ry: -24, t: 0.52 },
  { id: "legs0", ds: [P0], clip: "legs0", origin: "84% 72%", floor: [-5, -20], rz: 9, ry: 18, t: 0.65 },
  { id: "beam2", ds: [P2], clip: "beam2", origin: "47% 61%", floor: [-8, 102], rz: -30, ry: 26, t: 0.78 },
  { id: "legs2", ds: [P2, P3], clip: "legs2", origin: "49% 82%", floor: [128, 64], rz: 18, ry: -20, t: 0.91 },
];

const MOTION = {
  drift: (o) => animate({ ...o, ease: Easing.easeInOutSine }),
  lift: (o) => animate({ ...o, ease: Easing.easeOutBack }),
  fade: (o) => animate({ ...o, ease: Easing.easeOutQuad }),
};

const FLAT = 78; // grados tumbado en el suelo

function Piece({ p, T, cues, color, spread, shadow }) {
  const start = cues.Levantan - 0.1 + p.t * 1.06;
  const end = start + 0.62;
  const k = MOTION.lift({ from: 0, to: 1, start, end })(T);
  const q = 1 - k;

  // respiración mínima mientras espera en el suelo
  const wait = MOTION.drift({ from: 0, to: 1, start: 0, end: cues.Levantan + 1 })(T);
  const breathe = Math.sin((wait + p.t) * Math.PI * 2) * 3 * q;

  const hop = -34 * Math.sin(Math.PI * k);
  const tx = (q * p.floor[0] + breathe) * spread;
  const ty = (q * p.floor[1] + hop) * spread;
  const base = `rotateX(${q * FLAT}deg) rotateY(${q * p.ry}deg) rotateZ(${q * p.rz}deg)`;

  const svg = (fill, extra) => (
    <svg viewBox="0 0 512 512" width="100%" height="100%" style={{ display: "block", ...extra }}>
      <defs><clipPath id={"clip-" + p.id + (fill === color ? "" : "-s")}><polygon points={CLIPS[p.clip]} /></clipPath></defs>
      <g clipPath={`url(#clip-${p.id}${fill === color ? "" : "-s"})`}>
        {p.ds.map((d, i) => <path key={i} d={d} fill={fill} />)}
      </g>
    </svg>
  );

  return (
    <React.Fragment>
      {shadow ? (
        <div style={{
          position: "absolute", inset: 0, transformOrigin: p.origin,
          opacity: 0.13 * q, filter: "blur(7px)",
          transform: `translate3d(${(q * p.floor[0] + breathe) * spread}px,${q * p.floor[1] * spread + 10}px,0) rotateX(${FLAT}deg) rotateZ(${q * p.rz}deg)`,
        }}>{svg("#0B1F3A")}</div>
      ) : null}
      <div style={{
        position: "absolute", inset: 0, transformOrigin: p.origin,
        transform: `translate3d(${tx}px,${ty}px,0) ${base} scale(${0.94 + 0.06 * k})`,
      }}>{svg(color)}</div>
    </React.Fragment>
  );
}

function LogoAssembly({ tweaks }) {
  const { T, CUES } = useComposition();
  const color = (tweaks && tweaks.accent) || "#338BFD";
  const spread = (tweaks && tweaks.spread != null ? tweaks.spread : 100) / 100;
  const shadow = !tweaks || tweaks.shadow !== false;

  const zoom = MOTION.fade({ from: 1.08, to: 1, start: 0, end: 2.6 })(T);
  const settle = MOTION.lift({ from: 0.984, to: 1, start: CUES.Cierre - 0.15, end: CUES.Cierre + 0.4 })(T);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#ffffff", display: "grid", placeItems: "center", overflow: "hidden" }}>
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: "30%",
        background: "linear-gradient(to bottom, rgba(11,31,58,0) 0%, rgba(11,31,58,0.045) 100%)",
      }}></div>
      <div style={{
        width: 720, height: 720, position: "relative", perspective: "1500px",
        transform: `scale(${zoom * settle})`,
      }}>
        {PIECES.map((p) => <Piece key={p.id} p={p} T={T} cues={CUES} color={color} spread={spread} shadow={shadow} />)}
      </div>
    </div>
  );
}

window.LogoAssembly = LogoAssembly;

function LogoVideo() {
  const { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakColor, TweakSlider, CompositionStage } = window;
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <React.Fragment>
      <CompositionStage width={1080} height={1080} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK} bg="#ffffff">
        <LogoAssembly tweaks={t} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Animación" />
        <TweakSlider label="Dispersión en el suelo" value={t.spread} min={40} max={160} step={5} unit="%" onChange={(v) => setTweak('spread', v)} />
        <TweakToggle label="Sombra en el suelo" value={t.shadow} onChange={(v) => setTweak('shadow', v)} />
        <TweakSection label="Marca" />
        <TweakColor label="Color" value={t.accent} options={['#338BFD', '#0B1F3A', '#111111', '#E23A2E']} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}
window.LogoVideo = LogoVideo;
