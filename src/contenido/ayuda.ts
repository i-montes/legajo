export type Paso =
  | "conexion" | "perfil" | "sanidad" | "alcance"
  | "calibracion" | "revision" | "extraccion" | "grafo" | "fundamentos";

export interface Regla {
  titulo: string;
  texto: string;
}

export interface Ayuda {
  paso: string;
  titulo: string;
  que: string;
  meta: string;
  como: string[];
  /** Las decisiones que dos anotadores tienen que compartir para que el
   *  acuerdo entre ellos mida criterio y no memoria. */
  reglas?: Regla[];
}

/* Los textos de conexion, perfil y sanidad vienen literales del diseno.
   Los cinco restantes se redactaron en el mismo registro, que el diseno dejo
   sin escribir: explicar que es, que se busca y como hacerlo, sin jerga. */
/* Las reglas salieron de anotar artículos reales, no de un manual.
   Están aquí y no en la cabeza de nadie porque la doble anotación —dos personas
   sobre los mismos cien artículos— solo mide algo si las dos siguen el mismo
   criterio escrito. Sin esto, el desacuerdo mediría memoria, no comprensión. */
export const REGLAS: Regla[] = [
  {
    titulo: "Nombres propios sí, descripciones no",
    texto:
      "Se marca lo que sirve para buscar la entidad en otro artículo. «Ómar Yepes» sí; «político», «congresistas», «bandas criminales», «la cooperativa» o «sector transporte» no: son categorías, no entidades. Es el error más frecuente y el más caro.",
  },
  {
    titulo: "El artículo no es parte del nombre",
    texto:
      "Marca «Congreso», no «el Congreso». Salvo cuando el artículo va dentro del nombre de verdad: «La Silla Vacía», «Los Urabeños», «El Espectador».",
  },
  {
    titulo: "Marca lo que el texto afirma, no lo que sabes",
    texto:
      "Si el texto dice «el Gobernador de Antioquia» sin nombrarlo, no lo resuelvas de memoria. Fusionarlo con su nombre es trabajo del paso 7, con evidencia. Vale igual para «aliado de» y «opositor de».",
  },
  {
    titulo: "El cargo y la persona van separados",
    texto:
      "«Canciller Bermúdez» son dos marcas: «Canciller» (cargo) y «Bermúdez» (persona), unidas por «ocupa el cargo». Nunca un solo tramo. Y ministro no es lo mismo que ministerio: cargo frente a organización.",
  },
  {
    titulo: "Cifras: solo las que el texto afirma",
    texto:
      "«24 billones» del presupuesto sí. «Supongamos dos millones de desplazados» no: es una hipótesis para razonar. Marca el rango entero cuando lo sea: «48 a 108 meses», no dos números sueltos.",
  },
  {
    titulo: "Fechas y duraciones no son entidades",
    texto:
      "«26 de julio» o «más de diez años» son atributos de lo que se afirma, no cosas del mundo. Solo entran si van dentro de un nombre: «Ley 1448 de 2011», «el 9 de abril».",
  },
  {
    titulo: "Un evento tiene nombre",
    texto:
      "«El paro arrocero» o «el bicentenario» sí. Una oración narrativa —«en 2012 fue notificado Álvaro»— no. Si el tipo Evento se llena de frases, su precisión deja de significar nada.",
  },
  {
    titulo: "Las anáforas no se marcan si el nombre ya está",
    texto:
      "Tras «el Representante Telésforo Pedraza», el «El Representante» de después no añade nada. Reconocer entidades y resolver referencias son tareas distintas: incluir anáforas castiga al modelo por algo que no hace.",
  },
  {
    titulo: "«=» es identidad; «parte de» es pertenencia",
    texto:
      "«Ómar Yepes» = «Yepes»: la misma persona. «Comisión Tercera» parte de «Congreso»: una dentro de otra. Confundirlas mete datos falsos — el presupuesto de inversión no es el presupuesto, es una porción suya.",
  },
  {
    titulo: "Gentilicios, fuera",
    texto:
      "«venezolano», «caldense», «caleño» son adjetivos, no lugares. Solo entran dentro de un nombre más largo: «Estado colombiano», «Pacífico colombiano».",
  },
  {
    titulo: "Se puede marcar dentro de otra marca",
    texto:
      "«Antioquia» dentro de «Gobernador de Antioquia»: las dos son entidades y las dos van. Lo único que no cabe es una marca que empiece dentro de otra y termine fuera.",
  },
  {
    titulo: "Una descripción que señala a alguien: «sin nombre»",
    texto:
      "«El Gobernador de Antioquia», «la cooperativa»: el texto habla de una persona o una organización concreta y nunca la nombra. Se marca como cargo u organización —no como persona: convertirla en persona le enseñaría al modelo que esa cadena es un nombre propio— y se pulsa «sin nombre». El tipo no cambia; lo que cambia es que el grafo sabe que ahí falta una identidad, y puede proponerte quién ocupaba esa plaza por esas fechas.",
  },
  {
    titulo: "Cuándo fue cierta la relación",
    texto:
      "La fecha del artículo dice cuándo se afirmó algo, no cuándo fue verdad. «Carlos Costa, ministro de Ambiente» en 2010 y «el exministro Costa» en 2015 son la misma relación con vigencias opuestas, y fundirlas da un grafo que miente. Por defecto queda vigente, que es lo que el texto afirma en presente; el reloj junto a cada relación la pasa a pasada o futura. Cuando el texto dice «el entonces ministro» o «asumirá», se propone sola.",
  },
  {
    titulo: "El reloj mide trabajo, no presencia",
    texto:
      "Se detiene solo al cambiar de ventana y tras un minuto sin actividad. Si aun así una medición quedó contaminada, descártala: una cifra falsa desplaza la mediana de toda la muestra, y esa mediana es el resultado de la fase.",
  },
];

export const AYUDA: Record<Exclude<Paso, "fundamentos">, Ayuda> = {
  conexion: {
    paso: "Paso 1 de 8",
    titulo: "Conexión con el WordPress del medio",
    que: "Identifica el sitio y comprueba, con una contraseña de aplicación, que el archivo es tuyo.",
    meta: "Que Legajo no toque el archivo de nadie sin que su dueño lo haya autorizado.",
    como: [
      "Pega la dirección del sitio y el correo con el que entras a su WordPress. No hace falta el nombre de usuario: casi nadie lo sabe, y WordPress acepta el correo.",
      "Legajo lee solo el índice del sitio: cómo se llama, qué versión tiene y dónde se crean sus contraseñas. No mira el archivo.",
      "Crea una contraseña de aplicación en tu WordPress y pégala aquí. Es una clave aparte, solo para Legajo, que no es tu contraseña real y que revocas cuando quieras desde tu perfil.",
      "Legajo comprueba contra el sitio que esa cuenta tiene permisos de edición. Solo entonces empieza a leer.",
      "Leer un archivo público no exigiría nada de esto. Construir su grafo entero, sí: es la diferencia entre consultar y quedarse con él.",
    ],
  },
  perfil: {
    paso: "Paso 2 de 8",
    titulo: "Leer el archivo",
    que: "Un recorrido por todo el archivo leyendo solo metadatos —fecha, sección, titular—, nunca el cuerpo.",
    meta: "El universo del que después se recorta lo que se va a procesar.",
    como: [
      "Arranca solo: el permiso se dio en el paso anterior y no queda nada que decidir aquí.",
      "Va por tramos mensuales y con pausas de cortesía entre peticiones, así que tarda unos minutos en un archivo grande.",
      "Se guarda cada tramo al terminarlo. Detenerlo no pierde lo recorrido, y al volver retoma donde iba.",
      "Cuando acaba, pasa solo a los hallazgos. Se puede volver aquí desde la barra lateral para mirar el reparto por años y secciones.",
    ],
  },
  sanidad: {
    paso: "Paso 3 de 8",
    titulo: "Sanidad del archivo",
    que: "Hallazgos de calidad calculados sobre el censo —fechas dañadas, titulares repetidos, notas muy cortas— con ejemplos reales de tu instalación.",
    meta: "Saber qué conviene dejar fuera antes de gastar cómputo en ello.",
    como: [
      "Abre cada hallazgo y mira los ejemplos: son artículos reales, no estimaciones.",
      "Elige qué hacer con cada uno. Puedes cambiarlo después.",
    ],
  },
  alcance: {
    paso: "Paso 4 de 8",
    titulo: "Qué trozo del archivo procesar",
    que: "La selección de secciones y años sobre los que va a trabajar el extractor. No es una muestra estadística: es un alcance de trabajo.",
    meta: "Un lote acotado y trazable, con su coste de cómputo conocido de antemano.",
    como: [
      "Elige secciones en el árbol. Marcar una arrastra sus subsecciones: en WordPress un artículo regional no siempre lleva también la categoría madre.",
      "Acota los años si quieres empezar por lo reciente y ampliar después.",
      "Mira el cómputo estimado antes de crear el lote. Es tiempo de máquina, desatendido, pero conviene saberlo.",
      "Los artículos de calibración salen de aquí, repartidos entre secciones.",
    ],
  },
  calibracion: {
    paso: "Paso 5 de 8",
    titulo: "Enseñarle al extractor qué está haciendo mal",
    que: "El modelo corre sobre un puñado de artículos, tú corriges, y con esas correcciones se recalcula cómo se usa: el corte de confianza de cada tipo y qué no debe proponer nunca.",
    meta: "No descubrir a las cinco horas de cómputo que el extractor estaba etiquetando mal media cosa.",
    como: [
      "Elige los modelos. Con los que vienen por defecto se empieza bien.",
      "Deja que extraiga sobre los artículos de calibración; la primera vez descarga los modelos y tarda.",
      "Ve a revisar y corrige: borra lo que sobra, añade lo que falta, arregla los tipos.",
      "Vuelve aquí y calcula. Verás el antes y el después por tipo, y podrás aplicarlo al lote.",
    ],
  },
  revision: {
    paso: "Paso 6 de 8",
    titulo: "Revisar lo que propuso el extractor",
    que: "Corregir sobre lo ya marcado, no empezar de cero. Borrar lo que sobra, añadir lo que falta y unir las formas que nombran lo mismo.",
    meta: "Corregir es tres o cuatro veces más rápido que marcar desde cero, y produce la misma información: qué falla el modelo y un diccionario de entidades.",
    como: [
      "Lo punteado lo propuso la máquina; pulsarlo lo da por bueno. Lo que sobre se borra con ⌫.",
      "Selecciona texto y marca con 1—8 lo que el modelo no vio. Se marcan también sus repeticiones.",
      "Con dos marcas elegidas: «=» si nombran la misma cosa, «R» si son cosas distintas unidas por algo.",
      "Marca lo que el texto afirma, no lo que tú sabes del asunto.",
    ],
    reglas: REGLAS,
  },
  extraccion: {
    paso: "Paso 7 de 8",
    titulo: "Extracción sobre el lote entero",
    que: "El modelo, ya calibrado, recorre todo el lote sin intervención tuya.",
    meta: "Cobertura completa del alcance elegido, con los umbrales y el diccionario que salieron de tu revisión.",
    como: [
      "Lánzala y déjala correr. Es tiempo de máquina.",
      "Detener no pierde trabajo: cada artículo se guarda al terminarlo.",
      "Si la velocidad cae, suele ser el servidor del medio limitando peticiones durante la descarga.",
    ],
  },
  grafo: {
    paso: "Paso 8 de 8",
    titulo: "El grafo",
    que: "El resultado: entidades, sus formas equivalentes y las relaciones entre ellas, sobre el lote procesado.",
    meta: "Un índice consultable del archivo, y la base de cualquier cosa que se construya encima.",
    como: [
      "Mira primero las entidades más frecuentes: son las que sostienen el grafo.",
      "Las que aparecen una sola vez son la mayoría y aportan poco; no te preocupes por ellas todavía.",
      "El grafo funde los nombres que marcaste iguales con = al revisar, y solo esos: si ves «Petro» y «Gustavo Petro» separados, es que falta declararlo.",
      "El aviso de nombres parecidos señala los pares que probablemente sobren, pero no los une por su cuenta: una identidad inventada es peor que una repetida.",
      "Exporta cuando quieras llevártelo a otra herramienta.",
    ],
  },
};
