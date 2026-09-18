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
   tipos de las dos marcas elegidas, así que nunca se ven los veintiséis a
   la vez ni se puede afirmar que un monto ocupa un cargo.

   `apoya a` y `se opone a` son, en un archivo de poder colombiano, las dos
   relaciones que más veces explican una noticia. Estaban en el plan de la fase
   y se perdieron al implementar la pantalla.

   Esta tabla está duplicada a propósito en `core/src/extraccion.rs`: el menú no
   puede esperar a una llamada al backend para pintarse, y el extractor necesita
   las mismas restricciones para no proponer lo imposible. Las dos —y la de
   `sidecar/vocabulario.py`, que es la que aprendió el modelo— las reescribe
   `sidecar/generar_vocabulario.py`; hay una prueba en Rust que falla si se
   separan. Son 26 predicados en siete familias: cuando los que encajan entre dos
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
// «monto» y «obra» no admiten ninguno de los 26 predicados finos; sin uso en
// la tabla, sus siglas (M, B) se quitaron para que tsc no las marque como
// muertas.

/** Las familias, en el orden del menú. Coincide con `FAMILIAS` en
 *  `sidecar/vocabulario.py`. */
export const FAMILIAS: { k: string; etiqueta: string }[] = [
  { k: "familiar", etiqueta: "Familia" },
  { k: "laboral", etiqueta: "Cargos y trabajo" },
  { k: "empresa", etiqueta: "Empresa y dinero" },
  { k: "politica", etiqueta: "Política" },
  { k: "judicial", etiqueta: "Justicia" },
  { k: "lugar", etiqueta: "Lugar" },
  { k: "otro", etiqueta: "Otro" },
];

/* Lo que se recuerda al elegir un predicado, donde más se confunden. */
const NOTAS: Record<string, string> = {
  "ocupa el cargo": "Lo ejerce ahora según el texto. Si el texto dice «ex», «fue» o «entonces», usa «ocupó el cargo»; si solo se postula, «aspira al cargo».",
  "ocupó el cargo": "Lo ejerció y ya no: «exministro», «fue alcalde», «el entonces gobernador».",
  "aspira al cargo": "Se postula, suena o busca el cargo. Marcarlo como «ocupa» sería falso.",
  "nombró a": "Quien nombra puede ser una persona o una organización; el nombrado es una persona.",
  "sucedió a": "Reemplazó a otra persona en un cargo. De quien llega a quien se fue.",
  "trabaja en": "Empleo o asesoría sin cargo nombrado. Si el texto da el cargo, usa «ocupa el cargo».",
  "dirige": "Preside, gerencia o encabeza la organización.",
  "miembro de": "Militancia en un partido o pertenencia a junta, comisión o colectivo. Un adjetivo («el liberal X») no basta.",
  "fundó": "Creó la organización.",
  "propietario de": "Dueño, accionista o socio de una empresa. Entre dos personas, usa «socio de».",
  "socio de": "Dos personas socias en un negocio. Si el socio es de una empresa, «propietario de».",
  "parte de": "Una organización dentro de otra: filial, dependencia, adscrita. Nunca una persona.",
  "contrató a": "Contratación pública o privada afirmada en el texto.",
  "financia a": "Financió, donó o aportó. Solo si el texto lo afirma.",
  "apoya a": "Respaldo o alianza explícita, también a una ley o proyecto: quien vota a favor o declara su respaldo sin un acto legislativo propio. Si radica, redacta o es ponente, usa «impulsa». Solo si el texto lo afirma, no si tú lo sabes.",
  "se opone a": "Oposición o crítica explícita, también a una ley o proyecto: quien la critica, vota en contra o la hunde o archiva. Solo si el texto lo afirma.",
  "impulsa": "Acto legislativo sobre una norma: quien la radica, la redacta, es su ponente o la sanciona. Gana sobre «apoya a» cuando el texto describe el acto, no solo la postura.",
  "investigado por": "La organización que investiga: Fiscalía, Procuraduría, Contraloría, Corte.",
  "acusado por": "La organización que imputa o acusa.",
  "condenado por": "La organización que condena.",
  "ubicado en": "Sede, residencia o contención geográfica. No el origen («el caleño X») ni el lugar de los hechos.",
  "cónyuge de": "Esposo, esposa, pareja, compañero permanente, ex pareja.",
  "hijo de": "La cabeza es el hijo: «Nicolás Petro» hijo de «Gustavo Petro».",
  "hermano de": "Hermanos y hermanastros.",
  "familiar de": "Cuando el parentesco es otro: tío, primo, sobrino, cuñado, suegro, nieto, padrino.",
  "vínculo sin tipo": "El texto afirma un vínculo que no encaja en ninguna relación. Se conserva para revisión.",
};

const TABLA: Omit<Predicado, "nota">[] = [
  // generado desde sidecar/vocabulario.py: no editar a mano
  // Familia
  { etiqueta: "cónyuge de",       familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  { etiqueta: "hijo de",          familia: "familiar",  desde: [P],       hasta: [P], },
  { etiqueta: "hermano de",       familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  { etiqueta: "familiar de",      familia: "familiar",  desde: [P],       hasta: [P],             simetrico: true, },
  // Cargos y trabajo
  { etiqueta: "ocupa el cargo",   familia: "laboral",   desde: [P],       hasta: [C], },
  { etiqueta: "ocupó el cargo",   familia: "laboral",   desde: [P],       hasta: [C], },
  { etiqueta: "aspira al cargo",  familia: "laboral",   desde: [P],       hasta: [C], },
  { etiqueta: "nombró a",         familia: "laboral",   desde: [P, O],    hasta: [P], },
  { etiqueta: "sucedió a",        familia: "laboral",   desde: [P],       hasta: [P], },
  { etiqueta: "trabaja en",       familia: "laboral",   desde: [P],       hasta: [O], },
  { etiqueta: "dirige",           familia: "laboral",   desde: [P],       hasta: [O], },
  { etiqueta: "miembro de",       familia: "laboral",   desde: [P],       hasta: [O], },
  // Empresa y dinero
  { etiqueta: "fundó",            familia: "empresa",   desde: [P, O],    hasta: [O], },
  { etiqueta: "propietario de",   familia: "empresa",   desde: [P, O],    hasta: [O], },
  { etiqueta: "socio de",         familia: "empresa",   desde: [P],       hasta: [P],             simetrico: true, },
  { etiqueta: "parte de",         familia: "empresa",   desde: [O],       hasta: [O], },
  { etiqueta: "contrató a",       familia: "empresa",   desde: [O, P],    hasta: [O, P], },
  { etiqueta: "financia a",       familia: "empresa",   desde: [P, O],    hasta: [P, O], },
  // Política
  { etiqueta: "apoya a",          familia: "politica",  desde: [P, O],    hasta: [P, O, C, N], },
  { etiqueta: "se opone a",       familia: "politica",  desde: [P, O],    hasta: [P, O, N], },
  { etiqueta: "impulsa",          familia: "politica",  desde: [P, O],    hasta: [N], },
  // Justicia
  { etiqueta: "investigado por",  familia: "judicial",  desde: [P, O],    hasta: [O], },
  { etiqueta: "acusado por",      familia: "judicial",  desde: [P, O],    hasta: [O], },
  { etiqueta: "condenado por",    familia: "judicial",  desde: [P, O],    hasta: [O], },
  // Lugar
  { etiqueta: "ubicado en",       familia: "lugar",     desde: [P, O, L], hasta: [L], },
  // Otro
  { etiqueta: "vínculo sin tipo", familia: "otro",      desde: [],        hasta: [],              simetrico: true, },
  // fin de lo generado
];

export const PREDICADOS: Predicado[] = TABLA.map((p) => ({ ...p, nota: NOTAS[p.etiqueta] }));

const SIN_TIPO = "vínculo sin tipo";

/** Los que tienen sentido entre dos tipos concretos.
 *
 *  Ya no puede devolver una lista vacía: «vínculo sin tipo» no tiene
 *  restricciones de tipo (`desde`/`hasta` vacíos), así que encaja con
 *  cualquier par y siempre queda como reserva. Antes se devolvían los trece
 *  predicados cuando ninguno encajaba, para no bloquear a quien anota; luego,
 *  sin reserva todavía, la lista vacía era la respuesta honesta. Cuando lo
 *  único que ofrece este par es la reserva —que el vocabulario no une un lugar
 *  con una persona no es un hueco, es que lo que existe va al revés,
 *  «persona ubicado en lugar»— es la interfaz la que sugiere mirar el par al
 *  revés, con `sugerirInversa`. */
export function predicadosPara(tipoA: string, tipoB: string): Predicado[] {
  const encaja = (p: Predicado) =>
    (p.desde.length === 0 || p.desde.includes(tipoA)) &&
    (p.hasta.length === 0 || p.hasta.includes(tipoB));
  return PREDICADOS.filter(encaja);
}

/** Las relaciones tipadas que sí existen al invertir el par (tipoB, tipoA),
 *  sin contar la reserva «vínculo sin tipo»: como esa encaja en cualquier
 *  sentido, no es una pista de que el orden estaba al revés. Sirve para
 *  cuando `predicadosPara(tipoA, tipoB)` solo ofrece la reserva: así se sabe
 *  si el par tiene sentido tipado al revés («lugar», «persona» no tiene nada
 *  tipado, pero «persona», «lugar» sí: «ubicado en»). */
export function sugerirInversa(tipoA: string, tipoB: string): Predicado[] {
  return predicadosPara(tipoB, tipoA).filter((p) => p.etiqueta !== SIN_TIPO);
}
