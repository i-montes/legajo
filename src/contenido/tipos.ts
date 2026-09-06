/* Los ocho tipos de entidad del sistema, con su tecla y su color. */
export interface TipoEntidad {
  k: string;
  etiqueta: string;
  tecla: string;
  varName: string;
}

export const TIPOS: TipoEntidad[] = [
  { k: "persona",      etiqueta: "Persona",             tecla: "1", varName: "--e-persona" },
  { k: "organizacion", etiqueta: "Organización",        tecla: "2", varName: "--e-organizacion" },
  { k: "lugar",        etiqueta: "Lugar",               tecla: "3", varName: "--e-lugar" },
  { k: "cargo",        etiqueta: "Cargo o rol",         tecla: "4", varName: "--e-cargo" },
  { k: "ley",          etiqueta: "Ley o norma",         tecla: "5", varName: "--e-ley" },
  { k: "evento",       etiqueta: "Evento",              tecla: "6", varName: "--e-evento" },
  { k: "obra",         etiqueta: "Obra o publicación",  tecla: "7", varName: "--e-obra" },
  { k: "monto",        etiqueta: "Monto o cifra",       tecla: "8", varName: "--e-monto" },
];

export const colorTipo = (k: string) =>
  `var(${TIPOS.find((t) => t.k === k)?.varName ?? "--t3"})`;

/* ── Predicados ───────────────────────────────────────────────────────────
   Cada uno declara entre qué tipos tiene sentido. El menú se filtra por los
   tipos de las dos marcas elegidas, así que nunca se ven trece opciones a la
   vez ni se puede afirmar que un monto ocupa un cargo.

   `aliado de` y `opositor de` son, en un archivo de poder colombiano, las dos
   relaciones que más veces explican una noticia. Estaban en el plan de la fase
   y se perdieron al implementar la pantalla.

   Esta tabla está duplicada a propósito en `core/src/extraccion.rs`: el menú no
   puede esperar a una llamada al backend para pintarse, y el extractor necesita
   las mismas restricciones para no proponer lo imposible. Hay una prueba en
   Rust que compara las dos y falla si se separan. */

export interface Predicado {
  etiqueta: string;
  /** Vale en los dos sentidos: ser aliado es mutuo, ocupar un cargo no. */
  simetrico?: boolean;
  /** Tipos válidos para el origen. Vacío = cualquiera. */
  desde: string[];
  hasta: string[];
  /** Se recuerda al elegirlo, donde más falta hace. */
  nota?: string;
}

const P = "persona";
const O = "organizacion";
const C = "cargo";
const L = "lugar";
const N = "ley";
const M = "monto";
const B = "obra";
const E = "evento";

export const PREDICADOS: Predicado[] = [
  { etiqueta: "ocupa el cargo", desde: [P], hasta: [C],
    nota: "Lo ejerce ahora o lo ejercía según el texto. Si solo aspira, usa «aspira a»." },
  { etiqueta: "aspira a", desde: [P, O], hasta: [C],
    nota: "Se postula, suena o busca el cargo. Marcarlo como «ocupa» sería falso." },
  { etiqueta: "aliado de", simetrico: true, desde: [P, O], hasta: [P, O],
    nota: "Solo si el texto lo afirma, no si tú lo sabes." },
  { etiqueta: "opositor de", simetrico: true, desde: [P, O], hasta: [P, O],
    nota: "Solo si el texto lo afirma, no si tú lo sabes." },
  { etiqueta: "familiar de", simetrico: true, desde: [P], hasta: [P],
    nota: "Padre, hijo, hermano, cónyuge: el texto suele decir cuál." },
  { etiqueta: "investigado por", desde: [P, O], hasta: [O, N] },
  { etiqueta: "financia a", desde: [P, O], hasta: [P, O] },
  { etiqueta: "trabaja en", desde: [P], hasta: [O] },
  { etiqueta: "parte de", desde: [], hasta: [O, L, N, E],
    nota: "Pertenencia, no identidad. Va de la parte al todo: si las dos son la misma cosa, usa «=»." },
  { etiqueta: "citado en", desde: [P, O], hasta: [O, B] },
  { etiqueta: "ubicado en", desde: [], hasta: [L] },
  { etiqueta: "destinado a", desde: [M], hasta: [O, C, E, L, N],
    nota: "El destino de una partida: «10 mil millones para el bicentenario»." },
  { etiqueta: "sanciona con", desde: [N], hasta: [M],
    nota: "La pena que una norma establece." },
];

/** Los que tienen sentido entre dos tipos concretos.
 *
 *  Puede devolver una lista vacía, y eso es información: que el vocabulario no
 *  une un lugar con una persona no es un hueco, es que lo que existe va al
 *  revés —«persona ubicado en lugar»—. Antes se devolvían los trece cuando nada
 *  encajaba, con la idea de no bloquear a quien anota; pero trece opciones de
 *  las que ninguna aplica no es libertad, es ruido, y además dejaba cuatro
 *  fuera del alcance de las teclas 1—9. */
export function predicadosPara(tipoA: string, tipoB: string): Predicado[] {
  const encaja = (p: Predicado) =>
    (p.desde.length === 0 || p.desde.includes(tipoA)) &&
    (p.hasta.length === 0 || p.hasta.includes(tipoB));
  return PREDICADOS.filter(encaja);
}
