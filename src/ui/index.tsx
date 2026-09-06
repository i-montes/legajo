import type { CSSProperties, ReactNode } from "react";

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
