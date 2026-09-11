/* Los siete tipos de entidad del sistema, con su tecla y su color. */
export interface TipoEntidad {
  k: string;
  etiqueta: string;
  tecla: string;
  varName: string;
}

/* «Evento» se retiró en 2026-09: el modelo no lo aprende (el 90 % de lo que
   devolvía era nombre común) y el esquema de entrenamiento no lo tiene. Las
   marcas antiguas de ese tipo siguen en la base y se pintan con su color. */
export const TIPOS: TipoEntidad[] = [
  { k: "persona",      etiqueta: "Persona",             tecla: "1", varName: "--e-persona" },
  { k: "organizacion", etiqueta: "Organización",        tecla: "2", varName: "--e-organizacion" },
  { k: "lugar",        etiqueta: "Lugar",               tecla: "3", varName: "--e-lugar" },
  { k: "cargo",        etiqueta: "Cargo o rol",         tecla: "4", varName: "--e-cargo" },
  { k: "ley",          etiqueta: "Ley o norma",         tecla: "5", varName: "--e-ley" },
  { k: "obra",         etiqueta: "Obra o publicación",  tecla: "6", varName: "--e-obra" },
  { k: "monto",        etiqueta: "Monto o cifra",       tecla: "7", varName: "--e-monto" },
];

export const colorTipo = (k: string) =>
  `var(${TIPOS.find((t) => t.k === k)?.varName ?? (k === "evento" ? "--e-evento" : "--t3")})`;

/* ── Predicados ───────────────────────────────────────────────────────────
   Cada uno declara entre qué tipos tiene sentido. El menú se filtra por los
   tipos de las dos marcas elegidas, así que nunca se ven los treinta y cinco a
   la vez ni se puede afirmar que un monto ocupa un cargo.

   `aliado de` y `opositor de` son, en un archivo de poder colombiano, las dos
   relaciones que más veces explican una noticia. Estaban en el plan de la fase
   y se perdieron al implementar la pantalla.

   Esta tabla está duplicada a propósito en `core/src/extraccion.rs`: el menú no
   puede esperar a una llamada al backend para pintarse, y el extractor necesita
   las mismas restricciones para no proponer lo imposible. Las dos —y la de
   `sidecar/vocabulario.py`, que es la que aprendió el modelo— las reescribe
   `sidecar/generar_vocabulario.py`; hay una prueba en Rust que falla si se
   separan. Son 35 predicados en seis familias: cuando los que encajan entre dos
   tipos pasan de nueve, el menú pide primero la familia. */

export interface Predicado {
  etiqueta: string;
  /** Familia del predicado: agrupa el menú cuando la lista no cabe en 1—9. */
  familia: string;
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

/** Las familias, en el orden del menú. Coincide con `FAMILIAS` en
 *  `sidecar/vocabulario.py`. */
export const FAMILIAS: { k: string; etiqueta: string }[] = [
  { k: "familiar", etiqueta: "Familia" },
  { k: "laboral", etiqueta: "Trabajo e instituciones" },
  { k: "politica", etiqueta: "Política" },
  { k: "economica", etiqueta: "Dinero" },
  { k: "judicial", etiqueta: "Justicia" },
  { k: "fuente", etiqueta: "Lugar y fuente" },
];

/* Lo que se recuerda al elegir un predicado, donde más se confunden. */
const NOTAS: Record<string, string> = {
  "ocupa el cargo": "Lo ejerce ahora o lo ejercía según el texto. Si solo aspira, usa «aspira a».",
  "aspira a": "Se postula, suena o busca el cargo. Marcarlo como «ocupa» sería falso.",
  "aliado de": "Solo si el texto lo afirma, no si tú lo sabes.",
  "opositor de": "Solo si el texto lo afirma, no si tú lo sabes.",
  "familiar de": "Cuando el texto no dice cuál parentesco. Si dice padre, hijo, hermano o cónyuge, usa ese.",
  "miembro de": "Pertenece a la organización o al partido. «Parte de» es para una organización dentro de otra.",
  "parte de": "Pertenencia, no identidad. Va de la parte al todo: si las dos son la misma cosa, usa «=».",
  "se reunió con": "Solo si el texto narra la reunión, no si trabajan juntos.",
  "ubicado en": "Solo si el texto afirma la sede o el lugar, no porque lo sepas.",
  "destinado a": "El destino de una partida: «10 mil millones para el bicentenario».",
  "sanciona con": "La pena que una norma establece.",
  "acusado de": "El delito o la norma de que se le acusa. Quien acusa va con «demandó a» o «investigado por».",
};

const TABLA: Omit<Predicado, "nota">[] = [
  // generado desde sidecar/vocabulario.py: no editar a mano
  // Familia
  { etiqueta: "padre o madre de",    familia: "familiar",  desde: [P],       hasta: [P], },
  { etiqueta: "hijo de",             familia: "familiar",  desde: [P],       hasta: [P], },
  { etiqueta: "hermano de",          familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  { etiqueta: "cónyuge o pareja de", familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  { etiqueta: "familiar de",         familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  // Trabajo e instituciones
  { etiqueta: "ocupa el cargo",      familia: "laboral",   desde: [P],       hasta: [C], },
  { etiqueta: "trabaja en",          familia: "laboral",   desde: [P],       hasta: [O], },
  { etiqueta: "dirige",              familia: "laboral",   desde: [P],       hasta: [O, B], },
  { etiqueta: "fundó",               familia: "laboral",   desde: [P, O],    hasta: [O], },
  { etiqueta: "dueño de",            familia: "laboral",   desde: [P, O],    hasta: [O], },
  { etiqueta: "asesor de",           familia: "laboral",   desde: [P],       hasta: [P, O], },
  { etiqueta: "sucedió a",           familia: "laboral",   desde: [P],       hasta: [P], },
  { etiqueta: "nombró a",            familia: "laboral",   desde: [P, O],    hasta: [P], },
  { etiqueta: "renunció a",          familia: "laboral",   desde: [P],       hasta: [C, O], },
  { etiqueta: "parte de",            familia: "laboral",   desde: [],        hasta: [O, L, N], },
  // Política
  { etiqueta: "aliado de",           familia: "politica",  desde: [P, O],    hasta: [P, O],          simetrico: true, },
  { etiqueta: "opositor de",         familia: "politica",  desde: [P, O],    hasta: [P, O],          simetrico: true, },
  { etiqueta: "miembro de",          familia: "politica",  desde: [P],       hasta: [O], },
  { etiqueta: "aspira a",            familia: "politica",  desde: [P, O],    hasta: [C], },
  { etiqueta: "apoyó a",             familia: "politica",  desde: [P, O],    hasta: [P, O], },
  { etiqueta: "se reunió con",       familia: "politica",  desde: [P, O],    hasta: [P, O],          simetrico: true, },
  { etiqueta: "criticó a",           familia: "politica",  desde: [P, O],    hasta: [P, O, N], },
  // Dinero
  { etiqueta: "financia a",          familia: "economica", desde: [P, O],    hasta: [P, O], },
  { etiqueta: "contrató a",          familia: "economica", desde: [O, P],    hasta: [O, P], },
  { etiqueta: "socio de",            familia: "economica", desde: [P, O],    hasta: [P, O],          simetrico: true, },
  { etiqueta: "donó a",              familia: "economica", desde: [P, O],    hasta: [P, O], },
  { etiqueta: "destinado a",         familia: "economica", desde: [M],       hasta: [O, C, L, N], },
  // Justicia
  { etiqueta: "investigado por",     familia: "judicial",  desde: [P, O],    hasta: [O, N], },
  { etiqueta: "condenado por",       familia: "judicial",  desde: [P, O],    hasta: [O, N], },
  { etiqueta: "acusado de",          familia: "judicial",  desde: [P, O],    hasta: [N], },
  { etiqueta: "demandó a",           familia: "judicial",  desde: [P, O],    hasta: [P, O], },
  { etiqueta: "sanciona con",        familia: "judicial",  desde: [N],       hasta: [M], },
  // Lugar y fuente
  { etiqueta: "ubicado en",          familia: "fuente",    desde: [],        hasta: [L], },
  { etiqueta: "citado en",           familia: "fuente",    desde: [P, O],    hasta: [O, B], },
  { etiqueta: "autor de",            familia: "fuente",    desde: [P, O],    hasta: [B], },
  // fin de lo generado
];

export const PREDICADOS: Predicado[] = TABLA.map((p) => ({ ...p, nota: NOTAS[p.etiqueta] }));

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
