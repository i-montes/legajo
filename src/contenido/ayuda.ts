import type { PasoNav } from "./pasos";
export type { Paso } from "./pasos";

export interface Regla {
  titulo: string;
  texto: string;
}

export interface Ayuda {
  /** Qué es este paso, en dos frases. */
  que: string;
  /** Qué se consigue al terminar, para saber cuándo está hecho. */
  meta: string;
  /** Qué hace la persona aquí. Solo acciones; la razón de cada una va en `porque`. */
  como: string[];
  /** Por qué el paso es así y no de otra forma. Se lee aparte, para quien lo
   *  quiera: la mayoría de las veces basta con saber qué hacer. */
  porque?: string[];
  /** Qué pasa al terminar, para que nadie llegue al paso siguiente a ciegas. */
  despues: string;
  /** Las decisiones que dos anotadores tienen que compartir para que el
   *  acuerdo entre ellos mida criterio y no memoria. */
  reglas?: Regla[];
}

/* El registro es el mismo en los ocho: qué es, qué se busca, qué haces, qué
   pasa después. Sin jerga. Las razones —por qué se pide el correo y no el
   usuario, por qué se lee el archivo entero— van en un apartado propio: quien
   solo quiere terminar no tiene que leerlas, y quien desconfía las encuentra. */
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

export const AYUDA: Record<PasoNav, Ayuda> = {
  conexion: {
    que: "Identifica el sitio y comprueba, con una contraseña de aplicación, que el archivo es tuyo.",
    meta: "Que Legajo no toque el archivo de nadie sin que su dueño lo haya autorizado.",
    como: [
      "Pega la dirección del sitio y el correo con el que entras a su WordPress.",
      "Crea una contraseña de aplicación en tu WordPress —el enlace te lleva— y pégala aquí.",
      "Legajo comprueba contra el sitio que la cuenta tiene permisos de edición. Solo entonces empieza a leer.",
    ],
    porque: [
      "Se pide el correo y no el nombre de usuario porque casi nadie sabe cuál es su usuario en WordPress, y WordPress acepta el correo.",
      "Hasta que compruebes la contraseña, Legajo solo lee el índice del sitio: cómo se llama, qué versión tiene y dónde se crean sus contraseñas. No mira el archivo.",
      "La contraseña de aplicación es una clave aparte, solo para Legajo. No es tu contraseña real y la revocas cuando quieras desde tu perfil.",
      "Leer un archivo público no exigiría nada de esto. Construir su grafo entero, sí: es la diferencia entre consultar y quedarse con él.",
    ],
    despues: "La lectura del archivo arranca sola: el permiso ya está dado y no queda nada que decidir.",
  },
  perfil: {
    que: "Un recorrido por todo el archivo, trayéndose de cada pieza sus metadatos —fecha, sección, titular— y su texto, en la misma petición.",
    meta: "El archivo entero en tu disco: el universo del que después se recorta lo que se va a procesar.",
    como: [
      "Nada. Arranca solo y, cuando termina, pasa solo a los hallazgos.",
      "Si hace falta, «Detener». No pierde lo recorrido: cada tramo se guarda al terminarlo y al volver retoma donde iba.",
    ],
    porque: [
      "Va por tramos mensuales y con pausas de cortesía entre peticiones, al ritmo que el sitio aguanta. Como se trae el texto, tarda más que un recorrido de solo metadatos y ocupa disco.",
      "Es la única vez que se le pide el archivo al sitio. Los pasos siguientes leen de tu disco y no vuelven a la red.",
      "Se puede volver aquí desde la barra lateral para mirar el reparto por años y secciones, o para traer lo que el archivo publicó después.",
    ],
    despues: "Los hallazgos: qué tiene el archivo que convenga dejar fuera.",
  },
  sanidad: {
    que: "Hallazgos de calidad calculados sobre lo leído —fechas dañadas, titulares repetidos, notas muy cortas— con ejemplos reales de tu instalación.",
    meta: "Saber qué conviene dejar fuera antes de gastar cómputo en ello.",
    como: [
      "Abre cada hallazgo y mira los ejemplos: son artículos reales, no estimaciones.",
      "Elige qué hacer con cada uno. Los marcados con ▲ hay que decidirlos para seguir; el resto puede esperar.",
    ],
    porque: [
      "Son características del archivo, no errores del medio. Veinte años de migraciones dejan huellas, y es mejor verlas ahora que descubrirlas en el grafo.",
    ],
    despues: "Elegir el alcance: qué trozo del archivo se procesa.",
  },
  alcance: {
    que: "La selección de secciones y años sobre los que va a trabajar el extractor. No es una muestra estadística: es un alcance de trabajo.",
    meta: "Un lote acotado y trazable, con su coste de cómputo conocido de antemano.",
    como: [
      "Marca secciones en el árbol. Sin elegir nada, entra todo.",
      "Acota los años si quieres empezar por lo reciente y ampliar después.",
      "Decide cuántos artículos se revisan para calibrar y crea el lote.",
    ],
    porque: [
      "Marcar una sección arrastra sus subsecciones: en WordPress un artículo regional no siempre lleva también la categoría madre.",
      "El cómputo estimado es tiempo de máquina, desatendido. Se puede detener y retomar, pero conviene saberlo antes.",
      "Los artículos de calibración salen de aquí, repartidos entre secciones, no tomados en bloque.",
    ],
    despues: "La calibración: el extractor corre sobre esos pocos artículos y tú lo corriges.",
  },
  calibracion: {
    que: "El extractor corre sobre un puñado de artículos, tú corriges, y con esas correcciones se recalcula cómo se usa: el corte de confianza de cada tipo y qué no debe proponer nunca.",
    meta: "No descubrir a las cinco horas de cómputo que el extractor estaba etiquetando mal media cosa.",
    como: [
      "Extrae sobre los artículos de calibración. La primera vez descarga el modelo y tarda; después arranca en segundos.",
      "Pasa a revisar y corrige. Al cerrar el último artículo vuelves aquí y la calibración se calcula sola.",
      "Mira el antes y el después por tipo, y aplícala al lote.",
    ],
    porque: [
      "Es aritmética sobre las puntuaciones ya guardadas: el efecto se ve al instante y sin volver a pasar el modelo.",
      "No hay modelo que elegir. Hubo un menú con cuatro y un interruptor de relaciones; se midió sobre artículos reales y quedó el que saca entidades y relaciones en una sola pasada, en el GPU de tu computador si lo tiene.",
      "Bajar el modelo es lo único de la app que sale a la red, y trae pesos públicos: ningún texto de tu archivo se envía a ninguna parte.",
    ],
    despues: "La extracción sobre el resto del lote, con los cortes y el diccionario que salieron de tu revisión.",
  },
  revision: {
    que: "Corregir sobre lo ya marcado, no empezar de cero. Borrar lo que sobra, añadir lo que falta y unir las formas que nombran lo mismo.",
    meta: "Qué falla el modelo y un diccionario de entidades. Corregir es tres o cuatro veces más rápido que marcar desde cero, y produce la misma información.",
    como: [
      "Lo punteado lo propuso la máquina; pulsarlo lo da por bueno. Lo que sobre se borra con ⌫.",
      "Selecciona texto y marca con 1—8 lo que el modelo no vio. Se marcan también sus repeticiones.",
      "Con dos marcas elegidas: «=» si nombran la misma cosa, «R» si son cosas distintas unidas por algo.",
      "Cierra el artículo cuando esté. El reloj mide cuánto costó, y esa cifra es parte del resultado.",
    ],
    porque: [
      "Marca lo que el texto afirma, no lo que tú sabes del asunto. El grafo tiene que poder rastrear cada dato hasta una frase.",
      "Las reglas de abajo salieron de anotar artículos reales. Están escritas porque dos personas sobre los mismos artículos solo miden criterio si siguen las mismas.",
    ],
    despues: "Con el último artículo cerrado, la calibración se calcula con tus correcciones.",
    reglas: REGLAS,
  },
  extraccion: {
    que: "El extractor, ya calibrado, recorre la categoría que elijas sin intervención tuya.",
    meta: "Cobertura del alcance elegido, sección por sección, con los umbrales y el diccionario de tu revisión.",
    como: [
      "Elige una categoría de la cola. Elegir una madre arrastra sus hijas.",
      "Lánzala y déjala correr. Al terminar, la cola ofrece la siguiente.",
      "«Detener» no pierde trabajo: cada artículo se guarda al terminarlo.",
    ],
    porque: [
      "El texto ya está en disco desde la lectura, así que esto es cómputo puro: no depende del servidor del medio ni de la red.",
      "Se va por categorías, y no de golpe, para que el avance sea trazable en los términos que la redacción reconoce.",
    ],
    despues: "El grafo, que se puede mirar en cualquier momento con lo que ya haya extraído.",
  },
  grafo: {
    que: "El resultado: entidades, sus formas equivalentes y las relaciones entre ellas, sobre el lote procesado.",
    meta: "Un índice consultable del archivo, y la base de cualquier cosa que se construya encima.",
    como: [
      "Mira primero las entidades más frecuentes: son las que sostienen el grafo.",
      "Revisa los pares de nombres parecidos. El grafo solo funde los que marcaste iguales con «=» al revisar.",
      "Exporta cuando quieras llevártelo a otra herramienta.",
    ],
    porque: [
      "Las entidades que aparecen una sola vez son la mayoría y aportan poco. Es lo normal en un archivo grande.",
      "El aviso de nombres parecidos no los une por su cuenta: una identidad inventada es peor que una repetida.",
      "El ✓ distingue lo que una persona confirmó de lo que solo propuso el modelo. No valen lo mismo como dato.",
    ],
    despues: "Nada obligatorio. Se puede ampliar el alcance y volver a extraer; el grafo crece con el lote.",
  },
};
