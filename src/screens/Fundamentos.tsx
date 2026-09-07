import { Lienzo, Rotulo } from "../ui";
import { TIPOS } from "../contenido/tipos";

const TOKENS = [
  ["--bg", "fondo de la ventana", "#F4F1EA", "#1A1917"],
  ["--superficie", "barras, panel lateral", "#FAF8F3", "#211F1C"],
  ["--elevada", "menús flotantes", "#FFFEFA", "#2A2724"],
  ["--hundida", "pistas, campos, fila activa", "#EDE9E0", "#151412"],
  ["--borde", "borde sutil", "#E0D9CC", "#37332E"],
  ["--borde-fuerte", "borde de control", "#CFC5B4", "#4A453E"],
  ["--t1", "texto primario", "#1B1917", "#EDE9E2"],
  ["--t2", "texto secundario", "#565049", "#ADA69D"],
  ["--t3", "texto terciario", "#6E6659", "#9A938A"],
  ["--acento", "acción principal, único acento", "#2563EB", "#7BA6F7"],
  ["--exito", "estado correcto (con ✓)", "#4C6A38", "#93B573"],
  ["--advertencia", "solo si bloquea (con ▲)", "#92671C", "#D2A452"],
  ["--error", "fallo real (con ■)", "#8E3A30", "#D2867B"],
];

const ESCALA_TIPO = [
  ["Conecta el archivo", "display/36 · serif 500 · 1.14 · −.4px", "var(--font-serif-display)", 36, 500, 1.14, "-.4px"],
  ["El municipio que aprendió a contar", "titular/38 · serif 600 · 1.18", "var(--font-serif-display)", 38, 600, 1.18, "-.4px"],
  ["Cuerpo del artículo, medida 65—75 caracteres", "lectura/18 · sans 400 · 1.8", "var(--font-sans)", 18, 400, 1.8, "0"],
  ["Prosa de interfaz: la frase bajo el titular, los hallazgos", "cuerpo/15 · sans 400 · 1.7", "var(--font-sans)", 15, 400, 1.7, "0"],
  ["Etiquetas, filas de datos, navegación", "ui/13.5 · sans 400 · 1.45", "var(--font-sans)", 13.5, 400, 1.45, "0"],
  ["Metadatos y notas al pie", "menor/12.5 · sans 400", "var(--font-sans)", 12.5, 400, 1.5, "0"],
  ["DIAGNÓSTICO", "rótulo/11 · sans 400 · 1.4px tracking", "var(--font-sans)", 11, 400, 1.4, "1.4px"],
  ["post_date = 2013-04-02", "mono/12.5 · JetBrains Mono", "var(--font-mono)", 12.5, 400, 1.6, "0"],
] as const;

const ESPACIADO = [
  ["esp-1", 4, "separación dentro de una etiqueta"],
  ["esp-2", 8, "icono y texto"],
  ["esp-3", 12, "campos de un mismo grupo"],
  ["esp-4", 16, "padding de controles"],
  ["esp-6", 24, "padding de panel"],
  ["esp-8", 32, "entre grupos de datos"],
  ["esp-11", 44, "entre bloques de una pantalla"],
  ["esp-14", 56, "margen superior de pantalla"],
  ["esp-16", 64, "aire alrededor del lienzo de lectura"],
] as const;

export default function Fundamentos() {
  return (
    <Lienzo ancho={820}>
      <Rotulo style={{ marginBottom: 12 }}>Fundamentos</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 var(--esp-11)" }}>Tokens, tipografía y espaciado</h1>

      <Rotulo style={{ marginBottom: 14 }}>Tokens semánticos de color</Rotulo>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", marginBottom: "var(--esp-11)" }}>
        <div className="t-menor" style={{ color: "var(--t3)", paddingBottom: 6 }}>Claro</div>
        <div className="t-menor" style={{ color: "var(--t3)", paddingBottom: 6 }}>Oscuro</div>
        {TOKENS.map(([nombre, uso, claro, oscuro]) => (
          <Fragmento key={nombre} nombre={nombre} uso={uso} claro={claro} oscuro={oscuro} />
        ))}
      </div>

      <Rotulo style={{ marginBottom: 14 }}>Colores por tipo de entidad</Rotulo>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8, marginBottom: "var(--esp-11)" }}>
        {TIPOS.map((t) => (
          <div key={t.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--superficie)", borderRadius: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: `var(${t.varName})`, display: "block" }} />
            <span style={{ fontSize: 13, flex: 1 }}>{t.etiqueta}</span>
            <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{t.tecla}</span>
          </div>
        ))}
      </div>

      <Rotulo style={{ marginBottom: 14 }}>Escala tipográfica</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-6)", marginBottom: "var(--esp-11)" }}>
        {ESCALA_TIPO.map(([muestra, spec, fuente, size, peso, lh, ls]) => (
          <div key={spec}>
            <div style={{ fontFamily: fuente, fontSize: size, fontWeight: peso, lineHeight: lh, letterSpacing: ls, color: "var(--t1)", marginBottom: 4 }}>
              {muestra}
            </div>
            <div className="t-mono" style={{ color: "var(--t3)" }}>{spec}</div>
          </div>
        ))}
      </div>

      <Rotulo style={{ marginBottom: 14 }}>Escala de espaciado · base 4</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {ESPACIADO.map(([nombre, px, uso]) => (
          <div key={nombre} style={{ display: "grid", gridTemplateColumns: "70px 46px 1fr", alignItems: "center", gap: 12 }}>
            <span className="t-mono" style={{ color: "var(--t2)" }}>{nombre}</span>
            <span className="t-menor" style={{ color: "var(--t3)", textAlign: "right" }}>{px}px</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: px, height: 10, background: "var(--acento)", opacity: 0.5, borderRadius: 2, flex: "0 0 auto" }} />
              <span className="t-menor" style={{ color: "var(--t3)" }}>{uso}</span>
            </div>
          </div>
        ))}
      </div>
    </Lienzo>
  );
}

function Fragmento({ nombre, uso, claro, oscuro }: { nombre: string; uso: string; claro: string; oscuro: string }) {
  return (
    <>
      <Muestra color={claro} etiqueta={nombre} valor={claro} />
      <Muestra color={oscuro} etiqueta={uso} valor={oscuro} />
    </>
  );
}

function Muestra({ color, etiqueta, valor }: { color: string; etiqueta: string; valor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, background: color, border: "1px solid var(--borde)", display: "block", flex: "0 0 auto" }} />
      <span className="t-menor" style={{ flex: 1, color: "var(--t2)" }}>{etiqueta}</span>
      <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{valor}</span>
    </div>
  );
}
