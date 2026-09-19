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
function ocurrenciasEnTexto(pi: number, texto: string, patron: string): Tramo[] {
  const out: Tramo[] = [];
  const plano = plegar(texto);
  // Si el plegado no conservó la longitud, las posiciones no serían fiables.
  if (plano.length !== texto.length) return out;
  let desde = 0;
  for (;;) {
    const i = plano.indexOf(patron, desde);
    if (i < 0) break;
    const fin = i + patron.length;
    if (!esLetra(texto[i - 1]) && !esLetra(texto[fin])) out.push({ pi, ini: i, fin });
    desde = i + patron.length;
  }
  return out;
}

/** El título es el párrafo `pi = -1` (ver core/src/contenido.rs): así las
 *  anotaciones que ya existen sobre el cuerpo, con sus índices 0..n, no se
 *  mueven ni uno cuando el título entra a anotarse. `titulo` es opcional y
 *  por defecto no se busca en él, así que las llamadas que no lo pasan se
 *  comportan exactamente como antes. */
export function ocurrencias(parrafos: string[], aguja: string, titulo?: string | null): Tramo[] {
  const out: Tramo[] = [];
  if (aguja.trim().length < 2) return out;
  const patron = plegar(aguja);
  parrafos.forEach((texto, pi) => out.push(...ocurrenciasEnTexto(pi, texto, patron)));
  if (titulo) out.push(...ocurrenciasEnTexto(-1, titulo, patron));
  return out;
}

/* El texto de una marca es siempre el del documento, no el del patrón.
   Si se buscó «Twitter» y en el párrafo dice «twitter», la marca tiene que
   guardar «twitter»: la evaluación compara cadenas contra lo que el modelo
   devuelve, y ahí una diferencia de caja sería un fallo inventado.

   `t.pi === -1` es el título: no vive en `parrafos`, e indexar `parrafos[-1]`
   devolvería `undefined` en silencio en vez de fallar. */
const trozo = (parrafos: string[], t: Tramo, titulo?: string | null) =>
  t.pi === -1 ? (titulo ?? "").slice(t.ini, t.fin) : parrafos[t.pi].slice(t.ini, t.fin);

export const solapa = (t: Tramo, ms: { pi: number; ini: number; fin: number }[]) =>
  ms.some((m) => m.pi === t.pi && t.ini < m.fin && t.fin > m.ini);

let contador = 0;
export const nuevoId = () =>
  `m${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* Dos menciones nombran la misma forma si coinciden plegando tildes y caja. Es
   el mismo criterio con que la propagación decide que una aparición merece
   marca: usar aquí uno más estricto dejaría fuera del grupo justo a la que la
   propagación acaba de crear, por venir en versales en un ladillo. */
const mismaForma = (a: string, b: string) => plegar(a.trim()) === plegar(b.trim());

/** El grupo al que ya pertenece esta forma en el artículo, si alguno.
 *
 *  El extractor agrupa por correferencia, pero solo lo que él vio: una
 *  aparición que se le escapó y que después marca la persona nacía huérfana, y
 *  el panel la mostraba como una entidad más al lado de la suya. Parecía que la
 *  marca no se había hecho cuando sí estaba puesta, solo que suelta.
 */
export function grupoDeLaForma(
  existentes: Mencion[], texto: string, tipo: string
): string | undefined {
  const encaja = existentes.find(
    (m) => m.tipo === tipo && !!m.grupo && mismaForma(m.texto, texto)
  );
  return encaja?.grupo ?? undefined;
}

/** Mete en su grupo las menciones sueltas cuya forma ya pertenece a uno.
 *
 *  Para las anotaciones que ya se guardaron huérfanas, antes de que las nuevas
 *  heredaran el grupo al nacer. Se aplica al abrir el artículo.
 *
 *  Tiene un precio conocido: soltar un alias con la × guarda un nulo, que en la
 *  base es indistinguible de una mención que nunca tuvo grupo, así que una
 *  separación hecha a propósito se deshace al reabrir. Distinguirlas pide
 *  guardar aparte «esta la solté yo», y eso todavía no existe.
 */
export function absorberSueltas(menciones: Mencion[]): Mencion[] {
  let cambio = false;
  const out = menciones.map((m) => {
    if (m.grupo) return m;
    const grupo = grupoDeLaForma(menciones, m.texto, m.tipo);
    if (!grupo) return m;
    cambio = true;
    return { ...m, grupo };
  });
  // El mismo arreglo si no hubo nada que absorber: abrir un artículo no debe
  // contar como tocarlo ni disparar un guardado.
  return cambio ? out : menciones;
}

/** Las demás apariciones de un texto recién marcado, sin pisar lo que ya hay.
 *
 *  `titulo` extiende la búsqueda al título del artículo (`pi = -1`): una
 *  entidad marcada en el cuerpo se propone también ahí si aparece igual, con
 *  límites de palabra. Es el mismo mecanismo que ya baja los minutos por
 *  artículo, aplicado al único párrafo que hasta ahora quedaba fuera —y que
 *  medido sobre el oro es donde vive el 75 % de las entidades que el título
 *  repite sin marcar. */
export function propagarEnDocumento(
  parrafos: string[], texto: string, tipo: string, existentes: Mencion[], titulo?: string | null
): Mencion[] {
  if (!sePropaga(tipo)) return [];
  const acumulado = [...existentes];
  const nuevas: Mencion[] = [];
  for (const t of ocurrencias(parrafos, texto, titulo)) {
    if (solapa(t, acumulado)) continue;
    const suyo = trozo(parrafos, t, titulo);
    const m: Mencion = {
      mid: nuevoId(), pi: t.pi, ini: t.ini, fin: t.fin,
      texto: suyo, tipo, auto: true,
      grupo: grupoDeLaForma(acumulado, suyo, tipo),
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
export function aplicarLexico(parrafos: string[], lexico: EntradaLexico[], titulo?: string | null): Mencion[] {
  const out: Mencion[] = [];
  const utiles = lexico
    .filter((e) => !e.ambigua && sePropaga(e.tipo) && e.texto.trim().length >= 3)
    .sort((a, b) => b.texto.length - a.texto.length);

  for (const e of utiles) {
    for (const t of ocurrencias(parrafos, e.texto, titulo)) {
      if (solapa(t, out)) continue;
      out.push({
        mid: nuevoId(), pi: t.pi, ini: t.ini, fin: t.fin,
        texto: trozo(parrafos, t, titulo), tipo: e.tipo, auto: true,
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

  /* Se eligen dos marcas, pero lo que se declara es sobre la entidad: «Uribe es
     Álvaro Uribe». Entran con ellas las demás apariciones de sus mismas formas,
     porque dejar un «Uribe» suelto en el panel partiría en dos lo que se acaba
     de decir que es uno. La excepción son los tipos que no propagan: dos «50
     mil millones» se repiten por coincidencia, no porque el texto vuelva a
     referirse a lo mismo. */
  const arrastradas = menciones.filter((m) =>
    m.mid === a.mid || m.mid === b.mid ||
    [a, b].some((c) => sePropaga(c.tipo) && m.tipo === c.tipo && m.texto === c.texto)
  );

  const grupo = a.grupo ?? b.grupo ?? `g${a.mid}`;
  const mids = new Set(arrastradas.map((m) => m.mid));
  /* Los grupos que ya tenían las arrastradas vienen enteros, no solo la marca
     que entró: sacarla sola dejaría a sus compañeras apuntando a una identidad
     de la que ya no forma parte. */
  const viejos = new Set(arrastradas.map((m) => m.grupo).filter(Boolean) as string[]);
  return menciones.map((m) =>
    mids.has(m.mid) || (m.grupo && viejos.has(m.grupo)) ? { ...m, grupo } : m
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

export interface FilaPanel {
  /** La forma que encabeza la fila: la canónica del grupo. */
  texto: string;
  /** Todas las menciones de la fila, las de la canónica y las de sus subnombres. */
  mids: string[];
  designa: boolean;
  /** Las demás formas de la misma entidad. Vacío si nadie la unió a nada. */
  alias: { texto: string; mids: string[] }[];
}

/** Las filas de un tipo en el panel: una por entidad, no una por forma.
 *
 *  Unir «Uribe» con «Álvaro Uribe» declara que nombran a la misma persona. Si
 *  el panel las sigue mostrando como dos líneas con sus contadores aparte, la
 *  unión no se ve en el único sitio donde se está mirando, y la cifra de
 *  entidades del artículo cuenta dos donde hay una.
 *
 *  Agrupa por `grupo` cuando lo hay y por texto cuando no. El grupo manda: es
 *  una decisión de una persona sobre esta entidad concreta, y la coincidencia
 *  de texto solo una pista.
 *
 *  Solo mira las menciones del tipo pedido, y por eso un grupo que cruza tipos
 *  —«Ministro de Hacienda» unido a «Alberto Carrasquilla»— deja una fila en
 *  cada uno en vez de mudarse entero al del nombre propio. Las menciones están
 *  pintadas en el texto con el color de su tipo: si la cifra de la cabecera
 *  contara menciones de otro, dejaría de cuadrar con lo que se ve.
 */
export function filasDelPanel(menciones: Mencion[], tipo: string): FilaPanel[] {
  const items = menciones.filter((m) => m.tipo === tipo);
  const cubos = new Map<string, Mencion[]>();
  items.forEach((m, k) => {
    /* Sin grupo y de un tipo que no propaga, cada mención va suelta: dos
       «50 mil millones» en el mismo artículo suelen ser dos partidas distintas,
       y juntarlas aquí insinuaría una fusión que nadie declaró. */
    const clave = m.grupo ? `g:${m.grupo}` : sePropaga(tipo) ? `t:${m.texto}` : `m:${k}`;
    cubos.set(clave, [...(cubos.get(clave) ?? []), m]);
  });

  return [...cubos.values()].map((ms) => {
    const formas = [...new Set(ms.map((m) => m.texto))].map((texto) => ({
      texto,
      mids: ms.filter((m) => m.texto === texto).map((m) => m.mid),
    }));
    // Dentro de un tipo la más larga es la que mejor identifica: «Álvaro Uribe»
    // dice quién es y «Uribe» solo lo distingue de los demás de la frase.
    const canonica = formas.reduce((a, b) => (b.texto.length > a.texto.length ? b : a));
    return {
      texto: canonica.texto,
      mids: ms.map((m) => m.mid),
      // Basta con que una lo esté: son la misma entidad y el interruptor las
      // mueve todas a la vez.
      designa: ms.some((m) => !!m.designa),
      alias: formas.filter((f) => f.texto !== canonica.texto),
    };
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
