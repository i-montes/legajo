/* Avisos al marcar.
 *
 * El 13 % del primer lote de anotación fueron descripciones con sustantivo
 * común que después hubo que borrar: `político`, `congresistas`, `bandas
 * criminales`, `el Congreso`. Siempre el mismo error, y siempre detectable en
 * el momento de marcar.
 *
 * Son avisos, no bloqueos: la regla tiene excepciones legítimas —`La Silla
 * Vacía`, `Los Urabeños`— y quien anota sabe más del texto que esta heurística.
 */

export interface Aviso {
  texto: string;
  /** Recorte propuesto, si lo hay. */
  arreglo?: string;
  etiquetaArreglo?: string;
}

const ARTICULOS = ["el", "la", "los", "las", "un", "una", "unos", "unas"];

/** Palabras que casi nunca empiezan una entidad nombrada en prosa periodística. */
const GENERICAS = new Set([
  "gobierno", "estado", "congreso", "senado", "corte", "ministerio", "alcaldía",
  "gobernación", "policía", "ejército", "fiscalía", "procuraduría", "contraloría",
  "presidente", "ministro", "senador", "alcalde", "gobernador", "concejal",
  "representante", "magistrado", "fiscal", "director", "gerente", "político",
  "empresa", "cooperativa", "universidad", "sector", "banda", "bandas",
  "organización", "entidad", "institución", "partido", "movimiento",
]);

export function revisar(texto: string, tipo: string): Aviso[] {
  const avisos: Aviso[] = [];
  const t = texto.trim();
  if (!t) return avisos;

  const palabras = t.split(/\s+/);
  const primera = palabras[0];

  /* Un artículo en minúscula delante casi nunca es parte del nombre: se escribe
     «el Congreso» pero «La Silla Vacía». Si va en mayúscula, se calla. */
  if (palabras.length > 1 && ARTICULOS.includes(primera.toLowerCase()) && primera[0] === primera[0].toLowerCase()) {
    const sinArticulo = palabras.slice(1).join(" ");
    avisos.push({
      texto: `«${primera}» es un artículo, no parte del nombre.`,
      arreglo: sinArticulo,
      etiquetaArreglo: `marcar solo «${sinArticulo}»`,
    });
  }

  /* Un sustantivo común en minúscula suele ser una categoría, no una entidad.
     Los cargos son la excepción: «senador» es un cargo legítimo. */
  if (tipo !== "cargo" && tipo !== "monto") {
    const clave = primera.toLowerCase().replace(/[.,;:«»()]/g, "");
    if (GENERICAS.has(clave) && primera[0] === primera[0].toLowerCase()) {
      avisos.push({
        texto: "Empieza en minúscula por un sustantivo común: suele ser una categoría, no una entidad con nombre.",
      });
    }
  }

  /* Los plurales genéricos —«bandas criminales», «universidades públicas»— no
     nombran a nadie en concreto. */
  if (tipo !== "cargo" && palabras.length <= 3 && /(?:es|s)$/.test(primera) &&
      primera[0] === primera[0].toLowerCase() && GENERICAS.has(primera.toLowerCase())) {
    avisos.push({ texto: "Parece un plural genérico: no señala una entidad concreta." });
  }

  /* Un tramo muy largo casi siempre es una oración, no una entidad. */
  if (palabras.length > 8) {
    avisos.push({ texto: `${palabras.length} palabras: ¿es una entidad o una frase del texto?` });
  }

  return avisos;
}
