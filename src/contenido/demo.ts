/* ── Datos de demostración ─────────────────────────────────────────────────
   Vienen del canvas de diseño. Alimentan las pantallas cuyo backend todavía no
   existe, para poder revisar el diseño con material realista.

   Toda pantalla que los use tiene que mostrar el aviso <VistaPrevia/>: unas
   cifras convincentes sin marcar son indistinguibles de un resultado real, y
   esta app existe precisamente para producir cifras en las que confiar.        */

export interface ArticuloDemo {
  meta: string;
  titulo: string;
  roto: boolean;
  parrafos: string[];
  crudo?: string;
  semillas: { pi: number; needle: string; tipo: string }[];
}

export const ARTICULOS: ArticuloDemo[] = [
  {
    meta: "Conflicto y paz · 14 de marzo de 2016 · 1.842 palabras · Marcela Ospina",
    titulo: "El municipio que aprendió a contar sus muertos",
    roto: false,
    parrafos: [
      "En Montería, la Unidad de Víctimas cerró en marzo el censo que el municipio había postergado durante siete años. El resultado —11.400 personas reconocidas— no sorprendió a nadie en la Alcaldía, pero obligó a corregir el presupuesto de reparación que el Concejo aprobó en diciembre.",
      "La Ley 1448 de 2011 obliga a los municipios a mantener un registro propio, actualizado y verificable. Córdoba lo cumplió tarde y a medias: de los treinta municipios del departamento, solo nueve tenían un archivo consultable cuando la Defensoría del Pueblo pidió los datos en 2014.",
      "«Contar es una forma de reparación», dijo Luz Marina Pérez, directora de la oficina municipal de víctimas, durante la presentación del informe El costo de no saber, publicado esa semana por la Comisión de la Verdad.",
      "El censo costó 1.240 millones de pesos, casi el doble de lo previsto, y se hizo con encuestadores contratados por seis meses. Buena parte del sobrecosto se explica por los desplazamientos a corregimientos que no aparecen en los mapas oficiales del DANE.",
      "El Encuentro por la Memoria del Sinú, convocado en agosto en Lorica, reunió a las víctimas registradas con funcionarios de la Unidad para la Atención y Reparación Integral a las Víctimas. De ahí salió el compromiso de publicar el registro cada semestre.",
      "Diez años después, el municipio sigue siendo el único de la región con un archivo abierto. La secretaria de gobierno, Alba Nury Ríos, reconoce que la actualización depende de un contrato que se renueva cada año, y que nadie garantiza que el próximo alcalde lo firme.",
    ],
    semillas: [
      { pi: 0, needle: "Montería", tipo: "lugar" },
      { pi: 0, needle: "Unidad de Víctimas", tipo: "organizacion" },
      { pi: 1, needle: "Ley 1448 de 2011", tipo: "ley" },
      { pi: 1, needle: "Córdoba", tipo: "lugar" },
      { pi: 1, needle: "Defensoría del Pueblo", tipo: "organizacion" },
      { pi: 2, needle: "Luz Marina Pérez", tipo: "persona" },
      { pi: 2, needle: "directora de la oficina municipal de víctimas", tipo: "cargo" },
      { pi: 2, needle: "El costo de no saber", tipo: "obra" },
      { pi: 2, needle: "Comisión de la Verdad", tipo: "organizacion" },
      { pi: 3, needle: "1.240 millones de pesos", tipo: "monto" },
      { pi: 4, needle: "El Encuentro por la Memoria del Sinú", tipo: "evento" },
      { pi: 4, needle: "Lorica", tipo: "lugar" },
    ],
  },
  {
    meta: "Región · 2 de julio de 2013 · 604 palabras · autor no registrado",
    titulo: "Coletazos del paro arrocero en el bajo Sinú",
    roto: true,
    parrafos: [
      "Los arroceros de Montería levantaron el bloqueo de la vía a Planeta Rica luego de una reunión con el Ministerio de Agricultura que se extendió hasta la madrugada.",
      "El acuerdo incluye la compra de 4.000 toneladas por parte del Fondo de Estabilización de Precios, según confirmó Édgar Restrepo, vocero del comité arrocero.",
      "Los transportadores reportaron pérdidas por 800 millones de pesos durante los cuatro días de bloqueo.",
    ],
    crudo: `[caption id="attachment_8821" align="aligncenter" width="620"]Arroceros en la vía a Planeta Rica. Foto: archivo.[/caption]

Los arroceros de Montería levantaron el bloqueo de la vía a Planeta Rica luego de una reunión con el Ministerio de Agricultura que se extendió hasta la madrugada.

[su_quote cite="Édgar Restrepo"]El acuerdo incluye la compra de 4.000 toneladas[/su_quote]

<!-- wp:html --><div class="wpb_wrapper"><p>según confirmó Édgar Restrepo, vocero del comité arrocero.</p></div><!-- /wp:html -->

[gallery ids="8822,8823,8824"]

Los transportadores reportaron pérdidas por 800 millones de pesos durante los cuatro días de bloqueo.`,
    semillas: [
      { pi: 0, needle: "Montería", tipo: "lugar" },
      { pi: 0, needle: "Ministerio de Agricultura", tipo: "organizacion" },
      { pi: 1, needle: "Édgar Restrepo", tipo: "persona" },
    ],
  },
];

export interface CasoDemo {
  tipo: string;
  confianza: string;
  a: Candidato;
  b: Candidato;
}
export interface Candidato {
  rotulo: string;
  nombre: string;
  stats: string;
  menciones: { texto: string; fuente: string }[];
}

export const CASOS: CasoDemo[] = [
  {
    tipo: "Organización",
    confianza: "0,62",
    a: {
      rotulo: "Candidato A",
      nombre: "Unidad para la Atención y Reparación Integral a las Víctimas",
      stats: "214 menciones · 2012—2026 · 6 secciones",
      menciones: [
        { texto: "…funcionarios de la Unidad para la Atención y Reparación Integral a las Víctimas llegaron a Lorica con el registro impreso.", fuente: "Conflicto y paz · 2016" },
        { texto: "La Unidad para la Atención y Reparación Integral a las Víctimas respondió el derecho de petición nueve meses después.", fuente: "Investigaciones · 2019" },
      ],
    },
    b: {
      rotulo: "Candidato B",
      nombre: "Unidad de Víctimas",
      stats: "1.508 menciones · 2011—2026 · 6 secciones",
      menciones: [
        { texto: "En Montería, la Unidad de Víctimas cerró en marzo el censo que el municipio había postergado.", fuente: "Conflicto y paz · 2016" },
        { texto: "La Unidad de Víctimas abrió una jornada de atención en el corregimiento de Leticia.", fuente: "Región · 2022" },
      ],
    },
  },
  {
    tipo: "Persona",
    confianza: "0,48",
    a: {
      rotulo: "Candidato A",
      nombre: "Luz Marina Pérez",
      stats: "37 menciones · 2014—2018 · Conflicto y paz",
      menciones: [
        { texto: "«Contar es una forma de reparación», dijo Luz Marina Pérez, directora de la oficina municipal de víctimas.", fuente: "Conflicto y paz · 2016" },
        { texto: "Luz Marina Pérez entregó el cargo en octubre tras cuatro años en la oficina.", fuente: "Región · 2018" },
      ],
    },
    b: {
      rotulo: "Candidato B",
      nombre: "Luz M. Pérez Ortega",
      stats: "9 menciones · 2019—2024 · Economía",
      menciones: [
        { texto: "La contratista Luz M. Pérez Ortega figura en tres convenios de la gobernación.", fuente: "Economía · 2021" },
        { texto: "Luz M. Pérez Ortega no respondió a las preguntas enviadas por este medio.", fuente: "Investigaciones · 2024" },
      ],
    },
  },
];

export const PERFIL_ACTOS = [
  { cifra: "41.286", titulo: "artículos, sin huecos importantes", texto: "El archivo empieza el 3 de marzo de 2009 y no tiene interrupciones mayores a once días. Es una base sólida para medir cobertura en el tiempo." },
  { cifra: "68 %", titulo: "en bloques nombrados", texto: "Lo publicado desde 2019 usa Gutenberg, así que el destaque, el pie de foto y el cuerpo se distinguen solos. El 32 % anterior es HTML plano y necesitará más revisión humana." },
  { cifra: "1.842", titulo: "etiquetas, 1.190 usadas una sola vez", texto: "La taxonomía de etiquetas no sirve para estratificar. Las seis secciones sí: están bien repartidas y son estables en los diecisiete años." },
  { cifra: "4.100", titulo: "notas detrás del muro de pago", texto: "WP-Members recorta el cuerpo para el público. Legajo entra con tu sesión de editora, así que las lee completas." },
  { cifra: "3", titulo: "campos personalizados útiles", texto: "autor_invitado, fuente_original y geo_municipio. El último existe solo desde 2017, lo que limita cualquier análisis geográfico anterior." },
];

export const HALLAZGOS = [
  {
    titulo: "Artículos sin fecha confiable", conteo: "3.104", bloquea: true,
    detalle: "La importación de 2013 dejó la fecha de publicación igual a la fecha de importación. El campo post_date_gmt conserva el valor original en el 41 % de los casos.",
    consecuencia: "Estos 3.104 artículos no pueden asignarse a un estrato temporal, así que la estratificación por década queda incompleta mientras no decidas.",
    ejemplos: [["Consejo de seguridad en Tierralta", "post_date = 2013-04-02"], ["La ronda del arroz", "post_date = 2013-04-02"], ["Cuatro barrios sin agua", "sin post_date_gmt"]],
    opciones: ["Excluir del muestreo", "Estratificar por sección"],
  },
  {
    titulo: "HTML roto o shortcodes huérfanos", conteo: "1.297", bloquea: false,
    detalle: "Restos de plugins retirados (Shortcodes Ultimate, Visual Composer). El texto se recupera con una heurística, pero puede perder pies de foto y citas.",
    ejemplos: [["Coletazos del paro arrocero", "[su_quote] sin cierre"], ["El río que cambió de lado", "[caption] anidado"], ["Balance del invierno", "wpb_wrapper vacío"]],
    opciones: ["Incluir con la limpieza", "Excluir del muestreo"],
  },
  {
    titulo: "Posibles duplicados", conteo: "862", bloquea: false,
    detalle: "Pares con más del 92 % de similitud. La mayoría son republicaciones con titular cambiado; unas 200 son versiones actualizadas de la misma nota.",
    ejemplos: [["Paro arrocero: acuerdo", "96 % con #8821"], ["Acuerdo con arroceros", "96 % con #8907"], ["Montería: censo de víctimas", "93 % con #21044"]],
    opciones: ["Conservar solo una versión", "Incluir ambas"],
  },
  {
    titulo: "Contenido de agencia", conteo: "4.510", bloquea: false,
    detalle: "Notas firmadas por EFE, AP y Colprensa. Se pueden excluir del muestreo: aportan entidades internacionales que no describen el archivo local.",
    ejemplos: [["Cumbre en Bruselas", "EFE"], ["Mercados cierran al alza", "Colprensa"], ["Elecciones en Brasil", "AP"]],
    opciones: ["Excluir del muestreo", "Incluir tal cual"],
  },
  {
    titulo: "Notas muy cortas", conteo: "2.288", bloquea: false,
    detalle: "Menos de 120 palabras: breves de agenda, resultados deportivos y avisos. Rinden pocas entidades por artículo y encarecen la curación.",
    ejemplos: [["Cierre vial en la 41", "63 palabras"], ["Resultados: fecha 12", "88 palabras"], ["Agenda cultural", "41 palabras"]],
    opciones: ["Excluir del muestreo", "Incluir tal cual"],
  },
];

export const DISTRIBUCIONES = [
  {
    titulo: "Por década",
    filas: [
      { etiqueta: "2009—2013", archivo: 22, muestra: 31, sesgo: "+9 pt", alerta: true },
      { etiqueta: "2014—2019", archivo: 38, muestra: 36, sesgo: "−2 pt", alerta: false },
      { etiqueta: "2020—2026", archivo: 40, muestra: 33, sesgo: "−7 pt", alerta: true },
    ],
  },
  {
    titulo: "Por sección",
    filas: [
      { etiqueta: "Región", archivo: 34, muestra: 33, sesgo: "−1 pt", alerta: false },
      { etiqueta: "Política", archivo: 21, muestra: 22, sesgo: "+1 pt", alerta: false },
      { etiqueta: "Conflicto y paz", archivo: 17, muestra: 18, sesgo: "+1 pt", alerta: false },
      { etiqueta: "Economía", archivo: 14, muestra: 14, sesgo: "0", alerta: false },
      { etiqueta: "Cultura", archivo: 9, muestra: 8, sesgo: "−1 pt", alerta: false },
      { etiqueta: "Investigaciones", archivo: 5, muestra: 5, sesgo: "0", alerta: false },
    ],
  },
];

export const PRECISIONES = [
  { k: "persona", etiqueta: "Persona", valor: "0,94", pct: 94 },
  { k: "organizacion", etiqueta: "Organización", valor: "0,88", pct: 88 },
  { k: "lugar", etiqueta: "Lugar", valor: "0,91", pct: 91 },
  { k: "cargo", etiqueta: "Cargo o rol", valor: "0,72", pct: 72 },
  { k: "ley", etiqueta: "Ley o norma", valor: "0,83", pct: 83 },
  { k: "evento", etiqueta: "Evento", valor: "0,61", pct: 61 },
  { k: "obra", etiqueta: "Obra o publicación", valor: "0,58", pct: 58 },
  { k: "monto", etiqueta: "Monto o cifra", valor: "0,86", pct: 86 },
];

export const CURVA = [
  { etiqueta: "1 artículo", valor: "62 %", alto: 100 },
  { etiqueta: "2—4", valor: "24 %", alto: 39 },
  { etiqueta: "5—19", valor: "10 %", alto: 17 },
  { etiqueta: "20—49", valor: "3 %", alto: 6 },
  { etiqueta: "50+", valor: "1 %", alto: 3 },
];

export const EXT_LOG = [
  { hora: "14:02", texto: "reanudado en el artículo #20947" },
  { hora: "13:41", texto: "pausado por el usuario" },
  { hora: "11:08", texto: "lote 2009—2013 terminado · 9.081 artículos" },
  { hora: "09:55", texto: "modelo de entidades cargado en memoria (1,2 GB)" },
];
