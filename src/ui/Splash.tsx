/* La marca armándose: el arranque oficial de la app.
 *
 * Portado del lienzo de `splash_template/`, que corre sobre el runtime de
 * Claude Design —69 KB de `support.js` solo para reproducir la composición—.
 * Aquí no hace falta nada de eso: lo que vale del lienzo son las trayectorias,
 * los recortes y los tiempos, y todo eso son datos. La reproducción son treinta
 * líneas de interpolación y un `requestAnimationFrame`.
 *
 * Las tres sillas del logotipo se arman de abajo arriba —patas, asiento que
 * aterriza y se achata al tocar, respaldo— y luego se acercan hasta su sitio.
 */
import { useEffect, useRef, useState } from "react";

/* ── Geometría, vectorizada del logotipo original ───────────────────────── */
const P0 = "M349 1 L512 38 L512 408 L489 408 L489 262 L376 288 L373 289 L373 443 L349 443 L349 289 L239 263 L234 263 L234 275 L210 270 L210 233 L349 201 Z M374 146 L373 201 L489 228 L489 172 Z";
const P1 = "M1 70 L164 108 L164 512 L140 512 L140 269 L30 243 L24 242 L24 298 L129 274 L129 356 L24 332 L24 478 L0 478 Z";
const P2 = "M175 274 L303 303 L303 478 L280 478 L280 332 L175 356 Z";
const P3 = "M228 355 L234 355 L234 408 L210 408 L210 360 Z";

/* Cada pieza se recorta del trazo entero: así el respaldo y el asiento son el
   mismo dibujo partido, y no tres dibujos que hay que hacer coincidir. */
export const CLIPS: Record<string, string> = {
  back0: "195,-30 525,-30 525,218 349,193 195,225",
  seat0: "195,225 349,193 525,218 525,270 376,294 349,294 241,268 238,280 195,282",
  legs0: "195,282 238,280 241,268 349,294 376,294 525,270 525,540 195,540",
  back1: "-20,-30 170,-30 170,268 -20,239",
  seat1: "-20,239 170,268 170,364 129,357 -20,330",
  legs1: "-20,330 129,357 170,364 170,540 -20,540",
  beam2: "160,250 320,292 320,338 280,334 165,362",
  legs2: "165,362 280,334 320,338 320,540 165,540",
};

interface Pieza {
  id: string;
  ds: string[];
  clip: string;
  origin: string;
  rise: [number, number];
  t: number;
  land?: boolean;
}

interface Silla {
  id: string;
  delay: number;
  from: [number, number];
  shadow: { x: number; y: number; w: number; h: number };
  pieces: Pieza[];
}

export const SILLAS: Silla[] = [
  {
    id: "grande", delay: 0.05, from: [100, 0], shadow: { x: 84, y: 85, w: 30, h: 2.8 },
    pieces: [
      { id: "legs0", ds: [P0], clip: "legs0", origin: "84% 72%", rise: [0, 110], t: 0 },
      { id: "seat0", ds: [P0], clip: "seat0", origin: "68% 48%", rise: [0, -80], t: 0.16, land: true },
      { id: "back0", ds: [P0], clip: "back0", origin: "84% 25%", rise: [0, -190], t: 0.32 },
    ],
  },
  {
    id: "izquierda", delay: 0.72, from: [-100, 0], shadow: { x: 16, y: 92, w: 30, h: 2.8 },
    pieces: [
      { id: "legs1", ds: [P1], clip: "legs1", origin: "16% 84%", rise: [0, 120], t: 0 },
      { id: "seat1", ds: [P1], clip: "seat1", origin: "15% 59%", rise: [0, -70], t: 0.16, land: true },
      { id: "back1", ds: [P1], clip: "back1", origin: "16% 33%", rise: [0, -200], t: 0.32 },
    ],
  },
  {
    id: "pequena", delay: 1.34, from: [26, 60], shadow: { x: 47, y: 92, w: 23, h: 2.4 },
    pieces: [
      { id: "legs2", ds: [P2, P3], clip: "legs2", origin: "49% 82%", rise: [0, 90], t: 0 },
      { id: "beam2", ds: [P2], clip: "beam2", origin: "47% 61%", rise: [0, -60], t: 0.16, land: true },
    ],
  },
];

/* ── Escenas y tiempos, tal como los definía el lienzo ──────────────────── */
export const CUES = { Primera: 0, Otras: 1.0, Silencio: 2.2 };
/* Las tres escenas del lienzo suman 3 s y el crédito termina de aparecer sobre
   3,15. El resto es quietud a propósito: con todo ya puesto, da tiempo a mirar
   la marca antes de que la pantalla ceda el sitio. Alargar por aquí no toca la
   coreografía —cada pieza sigue anclada a su escena—, solo el rato que se
   sostiene el fotograma final. */
export const FIN = 5.4;
const DUR = 0.55;

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const tramo = (
  T: number, from: number, to: number, start: number, end: number,
  ease: (t: number) => number,
) => {
  // Un tramo de duración cero daría 0/0. El NaN no da error: se cuela en un
  // `transform` y la pieza desaparece, que es de los fallos más difíciles de
  // rastrear porque no deja ni rastro en la consola.
  if (end <= start) return T < start ? from : to;
  return from + (to - from) * ease(clamp01((T - start) / (end - start)));
};

function Pieza({ p, T, start, color }: { p: Pieza; T: number; start: number; color: string }) {
  const k = tramo(T, 0, 1, start, start + DUR, easeOutBack);
  const o = tramo(T, 0, 1, start, start + 0.14, easeOutQuad);
  const q = 1 - k;
  // El asiento aterriza: se achata un instante al tocar las patas.
  const sq = p.land
    ? 1 + 0.09 * Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.35)) * (k > 0.55 ? 1 : 0.35))
    : 1;
  const cid = `sp-${p.id}`;
  return (
    <div
      style={{
        position: "absolute", inset: 0, opacity: o, transformOrigin: p.origin,
        transform: `translate3d(${q * p.rise[0]}px,${q * p.rise[1]}px,0) scale(${1 / sq},${sq})`,
      }}
    >
      <svg viewBox="0 0 512 512" width="100%" height="100%" style={{ display: "block" }}>
        <defs>
          <clipPath id={cid}><polygon points={CLIPS[p.clip]} /></clipPath>
        </defs>
        <g clipPath={`url(#${cid})`}>
          {p.ds.map((d, i) => <path key={i} d={d} fill={color} />)}
        </g>
      </svg>
    </div>
  );
}

function Silla({ c, T, color }: { c: Silla; T: number; color: string }) {
  const base = CUES.Primera + c.delay;
  const armada = tramo(T, 0, 1, base, base + 0.5 + DUR, easeOutQuad);
  const junta = tramo(T, 1, 0, base + 0.5, CUES.Silencio + 0.3, easeInOutCubic);
  const s = c.shadow;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `translate3d(${junta * c.from[0]}px,${junta * c.from[1]}px,0)` }}>
      <div
        style={{
          position: "absolute", left: `${s.x}%`, top: `${s.y}%`,
          width: `${s.w}%`, height: `${s.h}%`, transform: "translate(-50%,0)",
          borderRadius: "50%", background: "#0B1F3A", opacity: 0.1 * armada,
          filter: "blur(6px)",
        }}
      />
      {c.pieces.map((p) => (
        <Pieza key={p.id} p={p} T={T} start={base + p.t} color={color} />
      ))}
    </div>
  );
}

/* El corazón va dibujado y no como emoji.
 *
 * El webview no siempre tiene una fuente de emoji en color —en WSL no la trae—,
 * y ❤️ salía en blanco y negro o como un cuadro vacío. Un trazo no depende de
 * qué fuentes tenga instaladas la máquina de nadie, y además se le puede dar el
 * tamaño y el color exactos que pide la línea. */
function Corazon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <path
        fill="#E23A2E"
        d="M12 21.6C12 21.6 2.4 15.5 2.4 8.9 2.4 5.6 5 3 8.2 3c1.8 0 3.2.9 3.8 2.1C12.6 3.9 14 3 15.8 3 19 3 21.6 5.6 21.6 8.9c0 6.6-9.6 12.7-9.6 12.7z"
      />
    </svg>
  );
}

export default function Splash({ onFin }: { onFin: () => void }) {
  const [T, setT] = useState(0);
  const [yendose, setYendose] = useState(false);
  const acabado = useRef(false);

  /* Quien pidió menos movimiento ve el fotograma final y nada más: la marca
     sigue estando, sin nada que se mueva. */
  const quieto =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const terminar = () => {
      if (acabado.current) return;
      acabado.current = true;
      setYendose(true);
      // Se desvanece antes de ceder el sitio, para que la app no aparezca de golpe.
      setTimeout(onFin, 260);
    };

    if (quieto) {
      setT(FIN);
      const t = setTimeout(terminar, 700);
      return () => clearTimeout(t);
    }

    let cuadro = 0;
    const t0 = performance.now();
    const tic = (ahora: number) => {
      const t = (ahora - t0) / 1000;
      setT(t);
      if (t >= FIN) terminar();
      else cuadro = requestAnimationFrame(tic);
    };
    cuadro = requestAnimationFrame(tic);

    // Nadie debería estar obligado a mirar una animación de tres segundos cada
    // vez que abre la app: cualquier tecla o clic la salta.
    const saltar = () => terminar();
    window.addEventListener("keydown", saltar);
    window.addEventListener("pointerdown", saltar);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("keydown", saltar);
      window.removeEventListener("pointerdown", saltar);
    };
  }, [onFin, quieto]);

  const zoom = tramo(T, 1.06, 1, 0, 2.7, easeOutQuad);
  const asiento = tramo(T, 0.99, 1, CUES.Silencio - 0.1, CUES.Silencio + 0.45, easeOutBack);
  const nombre = tramo(T, 0, 1, CUES.Silencio + 0.1, CUES.Silencio + 0.6, easeOutQuad);
  const credito = tramo(T, 0, 1, CUES.Silencio + 0.45, CUES.Silencio + 0.95, easeOutQuad);

  return (
    <div
      role="img"
      aria-label="Legajo, de La Silla Vacía"
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "#ffffff",
        display: "grid", placeItems: "center", overflow: "hidden",
        opacity: yendose ? 0 : 1, transition: "opacity .26s ease-out",
      }}
    >
      <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
        <div
          style={{
            width: "min(46vmin, 380px)", aspectRatio: "1",
            position: "relative", transform: `scale(${zoom * asiento})`,
          }}
        >
          {SILLAS.map((c) => (
            <Silla key={c.id} c={c} T={T} color="#2563EB" />
          ))}
        </div>
        <div
          style={{
            display: "grid", placeItems: "center", gap: 6, marginTop: 4,
            transform: `translateY(${(1 - nombre) * 6}px)`,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-serif-display)", fontSize: 30, letterSpacing: ".2px",
              color: "#0B1F3A", opacity: nombre, lineHeight: 1,
            }}
          >
            Legajo
          </div>
          {/* El crédito entra un instante después del nombre, no a la vez: dos
              líneas que aparecen juntas se leen como un bloque y ninguna de las
              dos se lee. */}
          <div
            style={{
              fontSize: 12.5, letterSpacing: ".2px", color: "#0B1F3A",
              opacity: credito * 0.6, display: "flex", alignItems: "center", gap: 5,
            }}
          >
            by La Silla Vacía with <Corazon />
          </div>
        </div>
      </div>
    </div>
  );
}
