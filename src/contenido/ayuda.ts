export type Paso =
  | "conexion" | "perfil" | "sanidad" | "muestreo"
  | "anotacion" | "extraccion" | "resolucion" | "reporte" | "fundamentos";

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
    titulo: "El reloj mide trabajo, no presencia",
    texto:
      "Se detiene solo al cambiar de ventana y tras un minuto sin actividad. Si aun así una medición quedó contaminada, descártala: una cifra falsa desplaza la mediana de toda la muestra, y esa mediana es el resultado de la fase.",
  },
];

export const AYUDA: Record<Exclude<Paso, "fundamentos">, Ayuda> = {
  conexion: {
    paso: "Paso 1 de 8",
    titulo: "Conexión con el WordPress del medio",
    que: "Legajo necesita leer el archivo desde dentro: entra al WordPress con tu propia cuenta de editora, con los mismos permisos que ya tienes.",
    meta: "Una conexión autorizada y guardada, para poder perfilar el archivo sin volver a pedirte credenciales.",
    como: [
      "Escribe la dirección del sitio como la usas a diario, por ejemplo labrujula.co.",
      "Pulsa «Conectar con WordPress»: se abrirá tu navegador con la solicitud de autorización del propio sitio.",
      "Acepta ahí la solicitud. Si no estabas con la sesión abierta, inicia sesión primero; esta ventana espera el tiempo que necesites.",
      "Si tu instalación no permite la autorización automática, usa «conectar manualmente» con una contraseña de aplicación.",
    ],
  },
  perfil: {
    paso: "Paso 2 de 8",
    titulo: "Perfil de la instalación",
    que: "Un retrato del archivo: cuántos artículos hay, en qué años, con qué editor se escribieron y qué plugins tocan el contenido.",
    meta: "Que sepas con qué material trabajas antes de invertir horas anotando, y que entiendas por qué unas partes costarán más que otras.",
    como: [
      "Lee de arriba abajo: cada cifra viene con la consecuencia práctica que tiene para el diagnóstico.",
      "No hay nada que configurar aquí. Si algo no cuadra con lo que sabes del medio, anótalo: suele indicar una migración mal hecha.",
      "Cuando termines, continúa a la sanidad del archivo.",
    ],
  },
  sanidad: {
    paso: "Paso 3 de 8",
    titulo: "Sanidad del archivo",
    que: "Cinco hallazgos de calidad —fechas dudosas, HTML roto, duplicados, contenido de agencia y notas muy cortas— con ejemplos reales de tu instalación.",
    meta: "Una regla explícita para cada hallazgo, de modo que la muestra sea defendible y el diagnóstico reproducible.",
    como: [
      "Abre cada hallazgo y mira los ejemplos: son artículos reales, no estimaciones.",
      "Elige una decisión por hallazgo. Puedes cambiarla más tarde volviendo a este paso.",
      "El muestreo se habilita cuando las cinco estén decididas.",
    ],
  },
  muestreo: {
    paso: "Paso 4 de 8",
    titulo: "Diseño de la muestra",
    que: "El plan de qué artículos vas a anotar a mano: cuántos, repartidos según qué criterios y con qué semilla de azar.",
    meta: "Una muestra que se parezca al archivo en lo que importa, y que cualquiera pueda reconstruir exactamente a partir de la semilla.",
    como: [
      "Ajusta el tamaño mirando la columna de sesgo: más artículos reducen el error, pero cada uno cuesta minutos de tu tiempo.",
      "Marca los criterios por los que quieres estratificar. Cada criterio que añades reparte la muestra en más celdas y deja menos casos en cada una.",
      "Anota la semilla o guárdala: sin ella el sorteo no es reproducible y el diagnóstico pierde su valor como evidencia.",
    ],
  },
  anotacion: {
    paso: "Paso 5 de 8",
    titulo: "Anotación manual",
    que: "Marcar a mano las entidades de cada artículo de la muestra. Es el patrón contra el que se mide después la extracción automática.",
    meta: "Un conjunto de referencia fiable y una medida honesta de cuántos minutos cuesta curar cien artículos.",
    como: [
      "Selecciona el texto de una entidad y elige su tipo, con el ratón o con las teclas 1 a 8.",
      "Para relacionar dos marcas, pulsa sobre ambas y luego R.",
      "No corrijas el reloj: si te levantas, púsalo. La medida solo sirve si refleja el tiempo real.",
      "Marca lo que el texto afirma, no lo que tú sabes del asunto. Es la regla que más sube el acuerdo entre anotadores.",
    ],
    reglas: REGLAS,
  },
  extraccion: {
    paso: "Paso 6 de 8",
    titulo: "Extracción automática",
    que: "El modelo recorre el archivo completo y propone entidades en cada artículo, sin intervención tuya.",
    meta: "Cobertura de todo el archivo para poder comparar lo que propone la máquina con lo que anotaste a mano.",
    como: [
      "Lánzala y déjala correr. Puedes minimizar y seguir usando el computador.",
      "Pausar no pierde trabajo: cada artículo se guarda antes de pasar al siguiente.",
      "Si la velocidad cae mucho, suele ser el servidor del medio limitando peticiones. Legajo espera y reintenta solo.",
    ],
  },
  resolucion: {
    paso: "Paso 7 de 8",
    titulo: "Resolución de entidades",
    que: "Decidir cuándo dos menciones distintas nombran a la misma persona u organización, y cuándo no.",
    meta: "Un índice donde cada entidad aparece una sola vez. Es lo que separa una lista de nombres de un archivo consultable.",
    como: [
      "Lee las menciones de cada candidato antes de decidir: el contexto desempata más que el parecido del nombre.",
      "Fusionar (F), separar (S) o no decidir (D). Cada caso se resuelve con una tecla.",
      "«No decidir» no penaliza: devuelve el caso a la cola para cuando haya más menciones que lo aclaren.",
    ],
  },
  reporte: {
    paso: "Paso 8 de 8",
    titulo: "Reporte de viabilidad",
    que: "El resultado del diagnóstico: qué tan bien funciona la extracción por tipo de entidad y cuánto costaría curar el archivo entero.",
    meta: "Una decisión informada sobre si seguir, con qué alcance y a qué coste — no una promesa.",
    como: [
      "Mira primero los minutos de curación por cada cien artículos: multiplicados por el archivo completo, dan las horas que la redacción tendría que poner.",
      "Compara esa cifra con las horas que de verdad puedes dedicar en tres meses. Si no cuadra, el alcance hay que recortarlo antes de seguir.",
      "El reporte exportable lleva solo métricas agregadas: puede compartirse sin exponer nada del archivo.",
    ],
  },
};
