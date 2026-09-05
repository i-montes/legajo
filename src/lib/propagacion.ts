import type { EntradaLexico, Mencion } from "../types";

/* Propagación de marcas: una entidad marcada una vez se marca en todas sus
   demás apariciones, y lo aprendido en un artículo pre-marca los siguientes.
   Es lo que baja los minutos por artículo, que es la cifra que persigue toda
   la fase. Vive aparte de la pantalla porque escribe en el patrón de oro: un
   fallo aquí corrompe la medición sin que nadie lo note. */

export interface Tramo { pi: number; ini: number; fin: number }

/* Tipos que no se propagan.
   Un nombre se repite porque el texto vuelve a referirse a lo mismo; una cifra
   se repite por coincidencia. En un mismo artículo «50 mil millones» puede ser
   la partida para la universidad pública en una frase y la del seguro de salud
   en la siguiente: propagar la marca las declararía la misma asignación e
   inyectaría un hecho falso en el grafo. Marcarlas a mano cuesta un segundo;
   deshacer una fusión inventada, mucho más. */
const NO_PROPAGABLES = new Set(["monto"]);

export const sePropaga = (tipo: string) => !NO_PROPAGABLES.has(tipo);

/** Solo cuenta si el texto está entero: «Ley» no puede casar dentro de «Leyva». */
const LETRA = /[\p{L}\p{N}]/u;
const esLetra = (c: string | undefined) => !!c && LETRA.test(c);

/* Pliega tildes y mayúscula, carácter a carácter.
   Uno a uno y no con normalize(): las posiciones de las marcas son
   desplazamientos dentro del párrafo, así que el texto plegado tiene que medir
   exactamente lo mismo que el original o todas las marcas quedan corridas.
   La eñe NO se pliega: «año» y «ano» son palabras distintas, y en español eso
   no es un detalle ortográfico. */
const TILDES: Record<string, string> = {
  "á": "a", "à": "a", "ä": "a", "â": "a", "ã": "a",
  "é": "e", "è": "e", "ë": "e", "ê": "e",
  "í": "i", "ì": "i", "ï": "i", "î": "i",
  "ó": "o", "ò": "o", "ö": "o", "ô": "o", "õ": "o",
  "ú": "u", "ù": "u", "ü": "u", "û": "u",
  "ç": "c",
};

export function plegar(s: string): string {
  const bajo = s.toLocaleLowerCase("es");
  // Si bajar la caja cambió la longitud —pasa con algún carácter exótico—, se
  // renuncia a plegar antes que devolver posiciones equivocadas.
  if (bajo.length !== s.length) return s;
  let out = "";
  for (const c of bajo) out += TILDES[c] ?? c;
  return out.length === s.length ? out : s;
}

/* El emparejamiento ignora mayúsculas y tildes.
   En el archivo la misma entidad aparece escrita de varias formas —«Twitter» en
   el cuerpo y «twitter» dentro de un paréntesis, un nombre en versales en un
   ladillo— y son la misma cosa. El precio es que un nombre propio que coincida
   con un sustantivo común puede proponerse de más: marcar «Estado colombiano»
   podría sugerir «estado» en otro sentido. Se asume a sabiendas, porque lo
   propagado sale con subrayado punteado y se descarta con una tecla, mientras
   que una aparición que no se propone hay que buscarla a mano.

   Lo mismo con las tildes: en el archivo abundan «Monteria», «Bogota» o
   «Ivan», y son la misma entidad que las bien acentuadas. */
export function ocurrencias(parrafos: string[], aguja: string): Tramo[] {
  const out: Tramo[] = [];
  if (aguja.trim().length < 2) return out;
  const patron = plegar(aguja);
  parrafos.forEach((texto, pi) => {
    const plano = plegar(texto);
    // Si el plegado no conservó la longitud, las posiciones no serían fiables.
    if (plano.length !== texto.length) return;
    let desde = 0;
    for (;;) {
      const i = plano.indexOf(patron, desde);
      if (i < 0) break;
      const fin = i + patron.length;
      if (!esLetra(texto[i - 1]) && !esLetra(texto[fin])) out.push({ pi, ini: i, fin });
      desde = i + patron.length;
    }
  });
  return out;
}

/* El texto de una marca es siempre el del documento, no el del patrón.
   Si se buscó «Twitter» y en el párrafo dice «twitter», la marca tiene que
   guardar «twitter»: la evaluación compara cadenas contra lo que el modelo
   devuelve, y ahí una diferencia de caja sería un fallo inventado. */
const trozo = (parrafos: string[], t: Tramo) => parrafos[t.pi].slice(t.ini, t.fin);

export const solapa = (t: Tramo, ms: { pi: number; ini: number; fin: number }[]) =>
  ms.some((m) => m.pi === t.pi && t.ini < m.fin && t.fin > m.ini);

let contador = 0;
export const nuevoId = () =>
  `m${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Las demás apariciones de un texto recién marcado, sin pisar lo que ya hay. */
export function propagarEnDocumento(
  parrafos: string[], texto: string, tipo: string, existentes: Mencion[]
): Mencion[] {
  if (!sePropaga(tipo)) return [];
  const acumulado = [...existentes];
  const nuevas: Mencion[] = [];
  for (const t of ocurrencias(parrafos, texto)) {
    if (solapa(t, acumulado)) continue;
    const m: Mencion = {
      mid: nuevoId(), pi: t.pi, ini: t.ini, fin: t.fin,
      texto: trozo(parrafos, t), tipo, auto: true,
    };
    acumulado.push(m);
    nuevas.push(m);
  }
  return nuevas;
}

/** Pre-marca un artículo virgen con lo aprendido en los anteriores.
 *
 *  De más largo a más corto: si ya se anotó «Unidad para la Atención y
 *  Reparación Integral a las Víctimas» y también «Unidad de Víctimas», el
 *  nombre largo tiene que ganar o quedaría partido en trozos.
 *
 *  Las entradas ambiguas —el mismo texto con tipos distintos en el archivo— se
 *  dejan fuera: proponer el tipo equivocado cuesta más de corregir que de
 *  marcar desde cero, y encima ancla a quien anota. */
export function aplicarLexico(parrafos: string[], lexico: EntradaLexico[]): Mencion[] {
  const out: Mencion[] = [];
  const utiles = lexico
    .filter((e) => !e.ambigua && sePropaga(e.tipo) && e.texto.trim().length >= 3)
    .sort((a, b) => b.texto.length - a.texto.length);

  for (const e of utiles) {
    for (const t of ocurrencias(parrafos, e.texto)) {
      if (solapa(t, out)) continue;
      out.push({
        mid: nuevoId(), pi: t.pi, ini: t.ini, fin: t.fin,
        texto: trozo(parrafos, t), tipo: e.tipo, auto: true,
      });
    }
  }
  return out.sort((a, b) => a.pi - b.pi || a.ini - b.ini);
}

/* ── Alias: declarar que dos menciones nombran la misma entidad ───────────
   Distinto de una relación. «Ómar Yepes» y «Yepes» son la misma persona;
   «presupuesto de inversión» y «presupuesto» son cosas distintas unidas por
   «parte de». Confundirlas mete datos falsos en el grafo: la entidad acabaría
   con dos cifras contradictorias atribuidas a la vez. */

/** Une los grupos de dos menciones. Si alguna ya pertenecía a uno, todos sus
 *  miembros se arrastran: así enlazar A con B y luego B con C deja las tres
 *  juntas, sin que el orden de los enlaces cambie el resultado. */
export function unirAlias(menciones: Mencion[], mid1: string, mid2: string): Mencion[] {
  const a = menciones.find((m) => m.mid === mid1);
  const b = menciones.find((m) => m.mid === mid2);
  if (!a || !b || a.mid === b.mid) return menciones;

  const grupo = a.grupo ?? b.grupo ?? `g${a.mid}`;
  const viejos = new Set([a.grupo, b.grupo].filter(Boolean) as string[]);
  return menciones.map((m) =>
    m.mid === a.mid || m.mid === b.mid || (m.grupo && viejos.has(m.grupo))
      ? { ...m, grupo }
      : m
  );
}

/** Saca una mención de su grupo. */
export function soltarAlias(menciones: Mencion[], mid: string): Mencion[] {
  return menciones.map((m) => (m.mid === mid ? { ...m, grupo: null } : m));
}

export interface GrupoAlias {
  grupo: string;
  tipo: string;
  /** La forma más larga: la que mejor identifica a la entidad. */
  canonica: string;
  formas: string[];
  menciones: number;
}

/** Agrupa las menciones para el panel: una entrada por entidad, no por forma. */
export function gruposDeAlias(menciones: Mencion[]): GrupoAlias[] {
  const porGrupo = new Map<string, Mencion[]>();
  for (const m of menciones) {
    if (!m.grupo) continue;
    const lista = porGrupo.get(m.grupo) ?? [];
    lista.push(m);
    porGrupo.set(m.grupo, lista);
  }
  return [...porGrupo.entries()].map(([grupo, ms]) => {
    const formas = [...new Set(ms.map((m) => m.texto))];
    // Un cargo nunca es la forma canónica si hay un nombre propio en el grupo:
    // «Ministro de Hacienda» describe un puesto, «Alberto Carrasquilla» nombra
    // a alguien, y es el nombre el que tiene que entrar al índice. La longitud
    // solo desempata entre formas del mismo rango — y empatan más de lo que
    // parece: esas dos miden exactamente igual.
    const mejor = ms.reduce((a, b) => {
      const rango = (m: Mencion) => (m.tipo === "cargo" ? 0 : 1);
      if (rango(b) !== rango(a)) return rango(b) > rango(a) ? b : a;
      return b.texto.length > a.texto.length ? b : a;
    });
    return { grupo, tipo: mejor.tipo, canonica: mejor.texto, formas, menciones: ms.length };
  });
}

/* ── Marcas anidadas ──────────────────────────────────────────────────────
   Una entidad puede vivir dentro de otra: «Gobernador de Antioquia» contiene
   «Antioquia», «Ministerio de Transporte» contiene «Transporte». Las dos son
   entidades de pleno derecho y el grafo las quiere por separado.

   Se admite la contención —una marca dentro de otra— pero no el cruce: que A
   empiece dentro de B y termine fuera no se puede representar ni en HTML ni de
   forma que signifique algo, y casi siempre es un error de selección. */

export interface NodoTexto { clase: "texto"; texto: string }
export interface NodoMarca { clase: "marca"; m: Mencion; hijos: Nodo[] }
export type Nodo = NodoTexto | NodoMarca;

/** ¿Cabe `nueva` junto a las existentes? Sí si no toca ninguna, o si contiene
 *  o está contenida por completo. No si se cruzan a medias. */
export function cabeAnidada(
  nueva: { pi: number; ini: number; fin: number },
  existentes: { pi: number; ini: number; fin: number }[]
): boolean {
  for (const m of existentes) {
    if (m.pi !== nueva.pi) continue;
    const toca = nueva.ini < m.fin && nueva.fin > m.ini;
    if (!toca) continue;
    const contiene = nueva.ini <= m.ini && nueva.fin >= m.fin;
    const contenida = nueva.ini >= m.ini && nueva.fin <= m.fin;
    // Idénticas: sería una marca duplicada sobre el mismo tramo.
    if (nueva.ini === m.ini && nueva.fin === m.fin) return false;
    if (!contiene && !contenida) return false;
  }
  return true;
}

function construir(texto: string, ms: Mencion[], desde: number, hasta: number): Nodo[] {
  const out: Nodo[] = [];
  let cur = desde;
  let i = 0;
  while (i < ms.length) {
    const m = ms[i];
    if (m.ini < cur || m.fin > hasta) { i++; continue; }
    if (m.ini > cur) out.push({ clase: "texto", texto: texto.slice(cur, m.ini) });
    const hijos: Mencion[] = [];
    let j = i + 1;
    while (j < ms.length && ms[j].ini < m.fin) {
      if (ms[j].fin <= m.fin) hijos.push(ms[j]);
      j++;
    }
    out.push({ clase: "marca", m, hijos: construir(texto, hijos, m.ini, m.fin) });
    cur = m.fin;
    i = j;
  }
  if (cur < hasta) out.push({ clase: "texto", texto: texto.slice(cur, hasta) });
  return out;
}

/** Árbol de un párrafo: texto plano y marcas, con las anidadas como hijas.
 *
 *  La propiedad que no puede romperse: concatenar todo el texto del árbol tiene
 *  que devolver el párrafo original, carácter por carácter. Si falla, el
 *  artículo se pinta con palabras duplicadas o desaparecidas. */
export function arbolDeParrafo(texto: string, marcas: Mencion[], pi: number): Nodo[] {
  const ms = marcas
    .filter((m) => m.pi === pi && m.ini >= 0 && m.fin <= texto.length && m.fin > m.ini)
    // Las contenedoras primero: a igual comienzo, gana la más larga.
    .sort((a, b) => a.ini - b.ini || b.fin - a.fin);
  return construir(texto, ms, 0, texto.length);
}

export function textoDeArbol(nodos: Nodo[]): string {
  return nodos
    .map((n) => (n.clase === "texto" ? n.texto : textoDeArbol(n.hijos)))
    .join("");
}
