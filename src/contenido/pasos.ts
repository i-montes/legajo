/* Los ocho pasos, definidos una sola vez.

   Antes cada pantalla escribía su propio «Paso 4 · Alcance», la barra lateral
   tenía otra lista, la ayuda otra, y la pantalla de conexión guardaba un mapa
   de nombres de pasos que ya no existían («muestreo», «reporte»). Cuando un
   paso cambiaba de nombre había que acordarse de cuatro sitios, y no se
   acordaba nadie. Aquí vive todo lo que se dice de un paso: cómo se llama,
   en qué fase cae, qué hace en una frase. Las pantallas lo leen. */

export type Paso =
  | "conexion" | "perfil" | "sanidad" | "alcance"
  | "calibracion" | "revision" | "extraccion" | "grafo" | "fundamentos";

/** Los ocho del recorrido; «fundamentos» es una página aparte, no un paso. */
export type PasoNav = Exclude<Paso, "fundamentos">;

/* Tres fases, porque ocho pasos en fila no se recuerdan y tres tramos sí. La
   primera solo pide permiso y espera; la segunda es donde se decide y se
   corrige; la tercera es cómputo desatendido y su resultado. */
export type Fase = "archivo" | "preparacion" | "resultado";

export interface DefFase {
  clave: Fase;
  nombre: string;
  /** Qué se consigue al terminar la fase, para leer en la barra lateral. */
  logro: string;
}

export const FASES: DefFase[] = [
  { clave: "archivo", nombre: "El archivo", logro: "Todo el archivo en tu disco, y sabes qué tiene." },
  { clave: "preparacion", nombre: "La preparación", logro: "Un lote acotado y un extractor que ya corregiste." },
  { clave: "resultado", nombre: "El resultado", logro: "Entidades y relaciones de todo el lote." },
];

export interface DefPaso {
  clave: PasoNav;
  /** Posición 0—7. Es lo que guarda `progreso` y lo que bloquea la barra. */
  indice: number;
  /** «01» … «08», para la barra. */
  num: string;
  /** Una o dos palabras: la barra lateral y los botones de volver. */
  etiqueta: string;
  /** El titular por defecto de la pantalla. Cada pantalla puede sustituirlo
   *  cuando su estado lo pide («Extracción terminada»). */
  titulo: string;
  /** Qué pasa aquí, en una línea. Cabe debajo del titular y en la ayuda. */
  frase: string;
  fase: Fase;
  /** Verbo para el botón que lleva hasta aquí desde el paso anterior. */
  ir: string;
}

export const PASOS: DefPaso[] = [
  {
    clave: "conexion", indice: 0, num: "01", etiqueta: "Conexión", fase: "archivo",
    titulo: "Conecta el archivo",
    frase: "La dirección del sitio y la prueba de que el archivo es tuyo.",
    ir: "Conectar",
  },
  {
    clave: "perfil", indice: 1, num: "02", etiqueta: "Lectura", fase: "archivo",
    titulo: "Leer el archivo entero",
    frase: "Legajo se trae cada pieza —metadatos y texto— a tu disco. Es la única vez que le pide el archivo al sitio.",
    ir: "Leer el archivo",
  },
  {
    clave: "sanidad", indice: 2, num: "03", etiqueta: "Hallazgos", fase: "archivo",
    titulo: "Qué tiene el archivo",
    frase: "Fechas dañadas, titulares repetidos, notas muy cortas: decide qué queda fuera antes de gastar cómputo en ello.",
    ir: "Ver los hallazgos",
  },
  {
    clave: "alcance", indice: 3, num: "04", etiqueta: "Alcance", fase: "preparacion",
    titulo: "Qué trozo del archivo procesar",
    frase: "Secciones y años. El resultado es un lote acotado con su coste de cómputo a la vista.",
    ir: "Elegir el alcance",
  },
  {
    clave: "calibracion", indice: 4, num: "05", etiqueta: "Calibración", fase: "preparacion",
    titulo: "Enseñarle al extractor qué hace mal",
    frase: "Corre sobre un puñado de artículos, tú corriges, y con eso se ajusta antes de soltarlo sobre el resto.",
    ir: "Calibrar",
  },
  {
    clave: "revision", indice: 5, num: "06", etiqueta: "Revisión", fase: "preparacion",
    titulo: "Corregir lo que propuso",
    frase: "Borrar lo que sobra, añadir lo que falta, unir lo que nombra lo mismo. Sobre lo ya marcado, no desde cero.",
    ir: "Revisar",
  },
  {
    clave: "extraccion", indice: 6, num: "07", etiqueta: "Extracción", fase: "resultado",
    titulo: "Recorrer el lote",
    frase: "El extractor, ya calibrado, va categoría por categoría sin que hagas nada. Es tiempo de máquina.",
    ir: "Extraer",
  },
  {
    clave: "grafo", indice: 7, num: "08", etiqueta: "Grafo", fase: "resultado",
    titulo: "El grafo",
    frase: "Entidades, sus formas equivalentes y las relaciones entre ellas, con lo que una persona confirmó distinguido.",
    ir: "Ver el grafo",
  },
];

export const TOTAL_PASOS = PASOS.length;

export const pasoDe = (clave: string): DefPaso | undefined =>
  PASOS.find((p) => p.clave === clave);

export const siguienteDe = (clave: PasoNav): DefPaso | undefined => {
  const p = pasoDe(clave);
  return p ? PASOS[p.indice + 1] : undefined;
};

export const anteriorDe = (clave: PasoNav): DefPaso | undefined => {
  const p = pasoDe(clave);
  return p && p.indice > 0 ? PASOS[p.indice - 1] : undefined;
};

export const faseDe = (clave: Fase): DefFase => FASES.find((f) => f.clave === clave)!;

/** «Paso 4 de 8» — el rótulo que encabeza cada pantalla y la ayuda. */
export const rotuloPaso = (clave: PasoNav): string => {
  const p = pasoDe(clave)!;
  return `Paso ${p.indice + 1} de ${TOTAL_PASOS} · ${p.etiqueta}`;
};

/** «el alcance», «la revisión»: para frases como «dejaste el archivo en …». */
export const nombreEnFrase = (clave: string): string => {
  const p = pasoDe(clave);
  if (!p) return clave;
  const art: Record<PasoNav, string> = {
    conexion: "la conexión", perfil: "la lectura del archivo", sanidad: "los hallazgos",
    alcance: "el alcance", calibracion: "la calibración", revision: "la revisión",
    extraccion: "la extracción", grafo: "el grafo",
  };
  return art[p.clave];
};
