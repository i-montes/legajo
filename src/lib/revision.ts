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

/* Palabras que sitúan una relación antes o después del artículo que la cuenta.
   «Ex», «entonces» y «fue» son las tres que aparecen una y otra vez en prosa
   política: «el entonces ministro», «el exgobernador», «fue director de».

   Los límites van con lookarounds sobre `\p{L}` y no con `\b`, porque `\b` de
   JavaScript no cuenta las vocales acentuadas como letra: entre la «á» de
   «asumirá» y el espacio siguiente no ve ninguna frontera, y la palabra no
   casaba nunca. Es el mismo fallo de tildes que ya apareció al propagar. */
const linde = (alternativas: string) =>
  new RegExp(`(?<!\\p{L})(?:${alternativas})(?!\\p{L})`, "iu");

const PASADO = linde(
  "ex|exministr\\p{L}*|expresident\\p{L}*|exgobernador\\p{L}*|exalcald\\p{L}*|" +
  "exsenador\\p{L}*|exdirector\\p{L}*|entonces|otrora|fue|había sido|salient\\p{L}+"
);

const FUTURO = linde(
  "asumirá|será|ocupará|reemplazará|entrante|electo|electa|designad\\p{L}+|" +
  "nombrad\\p{L}+ para|próximo|próxima"
);

/** Qué vigencia sugiere el texto alrededor de una relación.
 *
 *  La fecha del artículo dice cuándo se **afirmó** algo, no cuándo fue
 *  **cierto**: «Carlos Costa, ministro de Ambiente» en un artículo de 2010 y
 *  «el exministro Costa» en uno de 2015 son la misma relación con vigencias
 *  opuestas. Esto solo lo sugiere; quien anota lee la frase entera y decide.
 *
 *  Devuelve `null` cuando no hay señal, que es lo más común: el presente no
 *  deja marcas léxicas, y por eso «vigente» es el valor por defecto.
 */
export function vigenciaSugerida(contexto: string): "pasada" | "futura" | null {
  if (PASADO.test(contexto)) return "pasada";
  if (FUTURO.test(contexto)) return "futura";
  return null;
}

/** Un cargo o una organización sin nombre propio suele describir a alguien
 *  concreto: «el Gobernador de Antioquia», «la cooperativa». Vale la pena
 *  preguntarlo, porque es lo que convierte un cargo suelto en una identidad
 *  pendiente en el grafo. */
export function pareceDescripcion(texto: string, tipo: string): boolean {
  if (tipo !== "cargo" && tipo !== "organizacion") return false;
  const t = texto.trim();
  if (t.length < 4) return false;
  // Si lleva un nombre propio dentro, ya está nombrada: «Ministerio de
  // Hacienda» es una organización con nombre, no una descripción de otra cosa.
  const palabras = t.split(/\s+/).slice(1);
  const llevaNombre = palabras.some(
    (w) => w.length > 3 && w[0] === w[0].toUpperCase() && !/^(de|del|la|el|los|las|y|en|para)$/i.test(w)
  );
  return tipo === "cargo" ? !llevaNombre || /\bde\b/i.test(t) : !llevaNombre;
}

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
