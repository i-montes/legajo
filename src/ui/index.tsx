import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { pasoDe, rotuloPaso, type PasoNav } from "../contenido/pasos";

/* ── Glifos ────────────────────────────────────────────────────────────────
   El sistema usa forma ademas de color para el estado, para que un daltonico
   distinga un fallo de un aviso. La advertencia solo se usa cuando bloquea. */
export type Estado = "exito" | "advertencia" | "error" | "neutro";

const GLIFO: Record<Estado, string> = {
  exito: "✓",
  advertencia: "▲",
  error: "■",
  neutro: "·",
};
const COLOR: Record<Estado, string> = {
  exito: "var(--exito)",
  advertencia: "var(--advertencia)",
  error: "var(--error)",
  neutro: "var(--t3)",
};

export function Glifo({ estado, size = 12 }: { estado: Estado; size?: number }) {
  return (
    <span aria-hidden style={{ color: COLOR[estado], fontSize: size, lineHeight: 1 }}>
      {GLIFO[estado]}
    </span>
  );
}

export const colorEstado = (e: Estado) => COLOR[e];

/* ── Boton ─────────────────────────────────────────────────────────────── */
type BotonProps = {
  children: ReactNode;
  onClick?: () => void;
  variante?: "primario" | "secundario" | "texto" | "enlace";
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
};

export function Boton({
  children,
  onClick,
  variante = "primario",
  disabled,
  title,
  style,
}: BotonProps) {
  const base: CSSProperties = {
    appearance: "none",
    fontFamily: "var(--font-sans)",
    cursor: disabled ? "default" : "pointer",
    transition: "background 150ms cubic-bezier(.2,0,0,1), border-color 150ms, color 150ms",
    ...style,
  };

  const variantes: Record<string, CSSProperties> = {
    primario: {
      background: disabled ? "var(--hundida)" : "var(--acento)",
      color: disabled ? "var(--t3)" : "var(--bg)",
      border: "1px solid " + (disabled ? "var(--borde)" : "var(--acento)"),
      borderRadius: 8,
      padding: "11px 20px",
      fontSize: 14,
      fontWeight: 500,
    },
    secundario: {
      background: "transparent",
      color: "var(--t2)",
      border: "1px solid var(--borde)",
      borderRadius: 8,
      padding: "9px 16px",
      fontSize: 13,
    },
    texto: {
      background: "transparent",
      color: "var(--t3)",
      border: 0,
      padding: 0,
      fontSize: 12.5,
    },
    enlace: {
      background: "transparent",
      color: "var(--t3)",
      border: 0,
      padding: 0,
      fontSize: 12.5,
      textDecoration: "underline",
      textDecorationColor: "var(--borde-fuerte)",
      textUnderlineOffset: 3,
    },
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{ ...base, ...variantes[variante] }}
      onMouseEnter={(e) => {
        if (disabled) return;
        const s = e.currentTarget.style;
        if (variante === "primario") s.background = "var(--acento-fuerte)";
        else if (variante === "secundario") { s.borderColor = "var(--borde-fuerte)"; s.color = "var(--t1)"; }
        else s.color = "var(--t1)";
      }}
      onMouseLeave={(e) => {
        const s = e.currentTarget.style;
        const v = variantes[variante];
        s.background = String(v.background);
        s.color = String(v.color);
        if (variante === "secundario") s.borderColor = "var(--borde)";
      }}
    >
      {children}
    </button>
  );
}

/* ── Campo de texto ────────────────────────────────────────────────────── */
export function Campo({
  value,
  onChange,
  etiqueta,
  ayuda,
  placeholder,
  onEnter,
  type = "text",
  autoFocus,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Qué se pide. Va dentro del `<label>` que envuelve al campo, así que
   *  pulsarla enfoca el campo y un lector de pantalla los une sin que haya que
   *  acordarse de poner identificadores. */
  etiqueta?: string;
  /** Una línea debajo, para lo que no cabe en la etiqueta. */
  ayuda?: string;
  placeholder?: string;
  onEnter?: () => void;
  type?: string;
  autoFocus?: boolean;
  mono?: boolean;
}) {
  /* El campo va envuelto en su etiqueta y no al lado: un `placeholder` se borra
     en cuanto se escribe la primera letra, que es justo cuando hace falta saber
     qué se estaba rellenando. La etiqueta se queda. */
  const entrada = (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      spellCheck={false}
      placeholder={placeholder}
      aria-label={etiqueta ? undefined : placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      style={{
        width: "100%",
        height: 44,
        padding: "0 14px",
        background: "var(--hundida)",
        border: "1px solid var(--borde)",
        borderRadius: 8,
        color: "var(--t1)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: 14.5,
        outline: "none",
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acento)")}
      onBlur={(e) => (e.currentTarget.style.borderColor = "var(--borde)")}
    />
  );

  if (!etiqueta && !ayuda) return entrada;

  return (
    <label style={{ display: "block" }}>
      {etiqueta && (
        <span style={{ display: "block", fontSize: 12.5, color: "var(--t3)", marginBottom: 7 }}>
          {etiqueta}
        </span>
      )}
      {entrada}
      {ayuda && (
        <span style={{ display: "block", fontSize: 11.5, color: "var(--t3)", marginTop: 6, lineHeight: 1.55 }}>
          {ayuda}
        </span>
      )}
    </label>
  );
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: 12.5, color: "var(--t3)", marginBottom: 7 }}>
      {children}
    </label>
  );
}

export function Rotulo({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="t-rotulo" style={style}>{children}</div>;
}

/* ── Barra de progreso ─────────────────────────────────────────────────── */
export function Barra({ pct, alto = 3, color = "var(--acento)" }: { pct: number; alto?: number; color?: string }) {
  return (
    <div style={{ height: alto, background: "var(--hundida)", borderRadius: 999, overflow: "hidden" }}>
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: "100%",
          background: color,
          borderRadius: 999,
          transition: "width 400ms cubic-bezier(.2,0,0,1)",
        }}
      />
    </div>
  );
}

/* Punto que late: procesos en curso sin fin conocido. */
export function Latido({ color = "var(--acento)" }: { color?: string }) {
  return (
    <span
      style={{
        width: 7, height: 7, borderRadius: 999, background: color,
        display: "block", flex: "0 0 auto",
        animation: "legajo-latido 1.4s ease-in-out infinite",
      }}
    />
  );
}

/* ── Cifra con rotulo, para los paneles de metricas ────────────────────── */
export function Cifra({ valor, pie }: { valor: string; pie: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 30, lineHeight: 1.1, color: "var(--t1)" }}>
        {valor}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--t3)", marginTop: 4, maxWidth: "22ch" }}>{pie}</div>
    </div>
  );
}

/* Contenedor de pantalla: centra y limita la medida de lectura. */
export function Lienzo({ children, ancho = 760 }: { children: ReactNode; ancho?: number }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: ancho, margin: "0 auto", padding: "var(--esp-14) var(--esp-8) var(--esp-16)" }}>
        {children}
      </div>
    </div>
  );
}

/* ── Encabezado de paso ────────────────────────────────────────────────────
   Cada pantalla abría con un rótulo escrito a mano, un titular y un párrafo
   de cuatro o cinco líneas que mezclaba qué hacer con por qué se hace así.
   El párrafo se saltaba entero: demasiado largo para leerlo antes de actuar,
   y demasiado importante para no leerlo nunca.

   Ahora el encabezado tiene tres alturas: el rótulo sale de `pasos.ts`; el
   titular lo pone la pantalla según su estado; y debajo va una sola frase con
   lo que ocurre aquí. La razón larga, si la hay, se pliega detrás de «por qué
   así»: quien solo quiere seguir no la ve, quien desconfía la encuentra.     */
export function Encabezado({
  paso,
  titulo,
  frase,
  detalle,
  compacto,
}: {
  paso: PasoNav;
  /** Sustituye al titular por defecto del paso cuando el estado lo pide. */
  titulo?: ReactNode;
  /** Sustituye a la frase por defecto. `null` la quita. */
  frase?: ReactNode | null;
  /** La razón larga, plegada. Uno o varios párrafos. */
  detalle?: ReactNode;
  /** Menos aire debajo: para estados de espera y vacíos. */
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const def = pasoDe(paso)!;
  const fraseFinal = frase === undefined ? def.frase : frase;
  return (
    <header style={{ marginBottom: compacto ? "var(--esp-8)" : "var(--esp-11)" }}>
      <div className="t-rotulo" style={{ marginBottom: 12 }}>{rotuloPaso(paso)}</div>
      <h1 className="t-display" style={{ margin: 0 }}>{titulo ?? def.titulo}</h1>
      {fraseFinal && (
        <p className="t-cuerpo" style={{ margin: "14px 0 0", color: "var(--t2)", maxWidth: "58ch" }}>
          {fraseFinal}
          {detalle && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                aria-expanded={abierto}
                style={{ appearance: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--t3)", textDecoration: "underline", textDecorationColor: "var(--borde-fuerte)", textUnderlineOffset: 3 }}
              >
                {abierto ? "menos" : "¿por qué así?"}
              </button>
            </>
          )}
        </p>
      )}
      {detalle && abierto && (
        <div style={{ marginTop: 14, paddingLeft: 14, borderLeft: "2px solid var(--borde)", maxWidth: "58ch", display: "flex", flexDirection: "column", gap: 10 }}>
          {detalle}
        </div>
      )}
    </header>
  );
}

/** Un párrafo del detalle plegado. */
export function Razon({ children }: { children: ReactNode }) {
  return <p className="t-menor" style={{ margin: 0, color: "var(--t2)", lineHeight: 1.7 }}>{children}</p>;
}

/* ── Acciones al pie de un paso ────────────────────────────────────────────
   El botón que avanza va siempre al final, separado por una raya, con la
   nota que dice qué se lleva o qué queda pendiente. Antes cada pantalla lo
   colocaba a su manera —a veces arriba, a veces sin raya— y había que
   buscarlo. Se dibuja solo cuando hay algo que pulsar: un botón apagado
   ocupa el sitio de una acción y no es ninguna. */
export function Acciones({ children, nota, raya = true }: { children: ReactNode; nota?: ReactNode; raya?: boolean }) {
  return (
    <div style={{ marginTop: "var(--esp-11)", paddingTop: raya ? "var(--esp-6)" : 0, borderTop: raya ? "1px solid var(--borde)" : 0, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      {children}
      {nota && (
        <span className="t-menor" style={{ color: "var(--t3)", maxWidth: "46ch", lineHeight: 1.6 }}>{nota}</span>
      )}
    </div>
  );
}

/* ── Aviso en línea ────────────────────────────────────────────────────────
   Un fallo, una advertencia o una nota, con su glifo. Las pantallas lo
   escribían cada una a mano con los mismos doce estilos. */
export function Aviso({ estado, children }: { estado: Estado; children: ReactNode }) {
  const fondo: Record<Estado, string> = {
    exito: "var(--exito-fondo)", advertencia: "var(--advertencia-fondo)",
    error: "var(--error-fondo)", neutro: "var(--hundida)",
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: fondo[estado], borderRadius: 8, marginBottom: "var(--esp-8)" }}>
      <Glifo estado={estado} size={11} />
      <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65, whiteSpace: "pre-wrap", maxWidth: "62ch" }}>{children}</span>
    </div>
  );
}

/* ── Aviso de vista previa ─────────────────────────────────────────────────
   Marca las pantallas que todavia dibujan datos de demostracion. Sin esto,
   unas cifras verosimiles son indistinguibles de un resultado real, y toda la
   herramienta existe para producir cifras en las que se pueda confiar.        */
export function VistaPrevia({ falta }: { falta: string }) {
  return (
    <div
      style={{
        display: "flex", gap: 10, alignItems: "baseline",
        border: "1px dashed var(--borde-fuerte)", borderRadius: 8,
        padding: "10px 14px", marginBottom: "var(--esp-8)",
        background: "var(--hundida)",
      }}
    >
      <span aria-hidden style={{ color: "var(--t3)", fontSize: 12 }}>◇</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t2)" }}>
        <strong style={{ fontWeight: 500, color: "var(--t1)" }}>Vista previa del diseño.</strong>{" "}
        Las cifras de esta pantalla son de demostración, no de tu archivo. Falta {falta}.
      </span>
    </div>
  );
}

export { default as Cargando } from "./Cargando";
export type { PasoCarga } from "./Cargando";
