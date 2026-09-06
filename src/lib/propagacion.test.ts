import { describe, expect, it } from "vitest";
import { pareceDescripcion, vigenciaSugerida } from "./revision";
import {
  aplicarLexico, arbolDeParrafo, cabeAnidada, gruposDeAlias, ocurrencias, plegar,
  propagarEnDocumento, soltarAlias, textoDeArbol, unirAlias,
} from "./propagacion";
import type { NodoMarca } from "./propagacion";
import { predicadosPara } from "../contenido/tipos";
import { revisar } from "./revision";
import type { EntradaLexico, Mencion } from "../types";

const lex = (texto: string, tipo: string, ambigua = false): EntradaLexico =>
  ({ texto, tipo, articulos: 1, ambigua });

describe("ocurrencias", () => {
  it("encuentra todas las apariciones en todos los párrafos", () => {
    const p = ["Montería amaneció así.", "En Montería llovió. Montería otra vez."];
    expect(ocurrencias(p, "Montería")).toHaveLength(3);
  });

  it("no casa dentro de otra palabra", () => {
    // El fallo clásico: marcar «Ley» y pintar media palabra en «Leyva».
    expect(ocurrencias(["El senador Leyva habló."], "Ley")).toHaveLength(0);
    expect(ocurrencias(["La Ley 1448 obliga."], "Ley")).toHaveLength(1);
  });

  it("acepta signos de puntuación como frontera", () => {
    expect(ocurrencias(["Vino de Montería, y se fue."], "Montería")).toHaveLength(1);
    expect(ocurrencias(["«Montería»"], "Montería")).toHaveLength(1);
  });

  it("ignora mayúsculas: la misma entidad se escribe de varias formas", () => {
    // Caso real: «en Twitter» en el cuerpo y «(ver su twitter)» al final.
    const p = ["mensajes en Twitter a favor", "(ver su twitter)", "TWITTER en el ladillo"];
    expect(ocurrencias(p, "Twitter")).toHaveLength(3);
  });

  it("sigue respetando la frontera de palabra aunque ignore la caja", () => {
    expect(ocurrencias(["el senador leyva habló"], "Ley")).toHaveLength(0);
  });

  it("ignora agujas demasiado cortas", () => {
    expect(ocurrencias(["a b c"], "a")).toHaveLength(0);
  });

  it("ignora las tildes en los dos sentidos", () => {
    // En el archivo abundan los nombres sin acentuar.
    const p = ["Llegó a Montería.", "Salió de Monteria sin tilde.", "MONTERIA en versales."];
    expect(ocurrencias(p, "Montería")).toHaveLength(3);
    expect(ocurrencias(p, "Monteria")).toHaveLength(3);
  });

  it("no confunde la eñe: «año» y «ano» son palabras distintas", () => {
    expect(ocurrencias(["hace un año largo"], "ano")).toHaveLength(0);
    expect(ocurrencias(["Muñoz asistió"], "Munoz")).toHaveLength(0);
  });

  it("las posiciones siguen apuntando al texto correcto tras plegar", () => {
    // El fallo silencioso que arruinaría todo: plegar cambiando la longitud
    // corre las marcas y el subrayado aparece sobre otras palabras.
    const parrafo = "En Montería, la Unidad de Víctimas cerró el censo.";
    for (const aguja of ["Montería", "Unidad de Víctimas", "censo"]) {
      const [t] = ocurrencias([parrafo], aguja);
      expect(parrafo.slice(t.ini, t.fin).toLowerCase()).toBe(aguja.toLowerCase());
    }
  });
});

describe("plegar", () => {
  it("conserva la longitud, que es de lo que dependen las posiciones", () => {
    for (const s of ["Montería", "ÁÉÍÓÚ", "Muñoz", "La Guajira", "señor Ángel"]) {
      expect(plegar(s)).toHaveLength(s.length);
    }
  });

  it("baja la caja y quita tildes pero deja la eñe", () => {
    expect(plegar("Montería")).toBe("monteria");
    expect(plegar("MUÑOZ")).toBe("muñoz");
    expect(plegar("Güiza")).toBe("guiza");
    expect(plegar("Año")).toBe("año");
  });
});

describe("propagarEnDocumento", () => {
  const parrafos = ["Montería y Montería.", "Otra vez Montería."];

  it("marca las repeticiones y las deja como automáticas", () => {
    const ya: Mencion[] = [{ mid: "x", pi: 0, ini: 0, fin: 8, texto: "Montería", tipo: "lugar", auto: false }];
    const nuevas = propagarEnDocumento(parrafos, "Montería", "lugar", ya);
    expect(nuevas).toHaveLength(2);
    expect(nuevas.every((m) => m.auto)).toBe(true);
  });

  it("no pisa una marca existente", () => {
    const ya: Mencion[] = [{ mid: "x", pi: 0, ini: 0, fin: 8, texto: "Montería", tipo: "lugar", auto: false }];
    const nuevas = propagarEnDocumento(parrafos, "Montería", "lugar", ya);
    expect(nuevas.some((m) => m.pi === 0 && m.ini === 0)).toBe(false);
  });

  it("guarda el texto tal como aparece en el documento, no el del patrón", () => {
    // Si se guardara el patrón, la evaluación compararía «Twitter» contra el
    // «twitter» que devuelve el modelo y contaría un fallo que no existe.
    const nuevas = propagarEnDocumento(["ver su twitter aquí"], "Twitter", "organizacion", []);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].texto).toBe("twitter");
  });

  it("no se duplica a sí misma en la misma pasada", () => {
    const nuevas = propagarEnDocumento(["Bogotá Bogotá"], "Bogotá", "lugar", []);
    const claves = new Set(nuevas.map((m) => `${m.pi}:${m.ini}`));
    expect(claves.size).toBe(nuevas.length);
  });
});

describe("aplicarLexico", () => {
  it("el nombre largo gana al corto y no lo parte", () => {
    const parrafos = ["Funcionarios de la Unidad para la Atención a las Víctimas llegaron."];
    const ms = aplicarLexico(parrafos, [
      lex("Unidad", "organizacion"),
      lex("Unidad para la Atención a las Víctimas", "organizacion"),
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0].texto).toBe("Unidad para la Atención a las Víctimas");
  });

  it("deja fuera las entradas ambiguas", () => {
    const ms = aplicarLexico(["Cambio Radical creció."], [lex("Cambio Radical", "organizacion", true)]);
    expect(ms).toHaveLength(0);
  });

  it("devuelve las marcas en orden de lectura", () => {
    const ms = aplicarLexico(
      ["Petro y Uribe.", "Uribe otra vez."],
      [lex("Petro", "persona"), lex("Uribe", "persona")]
    );
    expect(ms.map((m) => [m.pi, m.ini])).toEqual([[0, 0], [0, 8], [1, 0]]);
  });

  it("nunca produce marcas solapadas", () => {
    const ms = aplicarLexico(
      ["La Comisión de la Verdad publicó el informe."],
      [lex("Comisión de la Verdad", "organizacion"), lex("Verdad", "obra"), lex("Comisión", "organizacion")]
    );
    for (const a of ms) {
      for (const b of ms) {
        if (a === b) continue;
        expect(a.pi !== b.pi || a.ini >= b.fin || a.fin <= b.ini).toBe(true);
      }
    }
  });

  it("el léxico también respeta la caja del documento", () => {
    const ms = aplicarLexico(["hoy en twitter se dijo"], [lex("Twitter", "organizacion")]);
    expect(ms).toHaveLength(1);
    expect(ms[0].texto).toBe("twitter");
    expect(ms[0].tipo).toBe("organizacion");
  });

  it("todo lo que propone queda marcado como automático", () => {
    const ms = aplicarLexico(["Montería otra vez."], [lex("Montería", "lugar")]);
    expect(ms.every((m) => m.auto)).toBe(true);
  });
});

describe("alias", () => {
  const m = (mid: string, texto: string, tipo = "persona", grupo?: string): Mencion =>
    ({ mid, pi: 0, ini: 0, fin: texto.length, texto, tipo, auto: false, grupo });

  it("unir dos menciones les da el mismo grupo", () => {
    const r = unirAlias([m("1", "Ómar Yepes"), m("2", "Yepes")], "1", "2");
    expect(r[0].grupo).toBeTruthy();
    expect(r[0].grupo).toBe(r[1].grupo);
  });

  it("enlazar en cadena deja las tres juntas", () => {
    // A=B y luego B=C tiene que dejar A, B y C en el mismo grupo, o el orden
    // en que la persona enlaza cambiaría el resultado.
    let ms = [m("1", "Ómar Yepes"), m("2", "Yepes"), m("3", "el político caldense", "cargo")];
    ms = unirAlias(ms, "1", "2");
    ms = unirAlias(ms, "2", "3");
    expect(new Set(ms.map((x) => x.grupo)).size).toBe(1);
  });

  it("unir dos grupos ya formados los fusiona enteros", () => {
    let ms = [m("1", "A"), m("2", "B"), m("3", "C"), m("4", "D")];
    ms = unirAlias(ms, "1", "2");
    ms = unirAlias(ms, "3", "4");
    ms = unirAlias(ms, "2", "3");
    expect(new Set(ms.map((x) => x.grupo)).size).toBe(1);
  });

  it("soltar saca solo a esa mención", () => {
    let ms = unirAlias([m("1", "Ómar Yepes"), m("2", "Yepes")], "1", "2");
    ms = soltarAlias(ms, "2");
    expect(ms[1].grupo).toBeNull();
    expect(ms[0].grupo).toBeTruthy();
  });

  it("el nombre propio gana al cargo aunque midan lo mismo", () => {
    const ms = unirAlias(
      [m("1", "Ministro de Hacienda", "cargo"), m("2", "Alberto Carrasquilla", "persona")],
      "1", "2"
    );
    const [g] = gruposDeAlias(ms);
    expect(g.canonica).toBe("Alberto Carrasquilla");
    expect(g.tipo).toBe("persona");
    expect(g.formas).toHaveLength(2);
  });

  it("entre iguales gana la forma más larga", () => {
    const ms = unirAlias([m("1", "Yepes"), m("2", "Ómar Yepes")], "1", "2");
    expect(gruposDeAlias(ms)[0].canonica).toBe("Ómar Yepes");
  });

  it("las menciones sueltas no forman grupo", () => {
    expect(gruposDeAlias([m("1", "Montería", "lugar")])).toHaveLength(0);
  });
});

describe("cifras", () => {
  it("no se propagan dentro del artículo", () => {
    // Caso real: «50 mil millones» para la universidad en una frase y para el
    // seguro de salud en la siguiente. Son dinero distinto.
    const p = [
      "la universidad pública (50 mil millones) y otras inversiones",
      "y 50 mil millones para el seguro obligatorio de salud",
    ];
    expect(propagarEnDocumento(p, "50 mil millones", "monto", [])).toHaveLength(0);
    // Un nombre en la misma posición sí se propaga.
    expect(propagarEnDocumento(["Montería y Montería"], "Montería", "lugar", [])).toHaveLength(2);
  });

  it("tampoco entran al léxico de artículos siguientes", () => {
    const ms = aplicarLexico(
      ["se agregaron 10 mil millones y llegó a Montería"],
      [{ texto: "10 mil millones", tipo: "monto", articulos: 3, ambigua: false },
       { texto: "Montería", tipo: "lugar", articulos: 3, ambigua: false }]
    );
    expect(ms.map((m) => m.tipo)).toEqual(["lugar"]);
  });
});

describe("marcas anidadas", () => {
  const mk = (ini: number, fin: number, texto: string, tipo = "lugar"): Mencion =>
    ({ mid: `${ini}-${fin}`, pi: 0, ini, fin, texto, tipo, auto: false });

  const P = "El Gobernador de Antioquia habló.";

  it("el texto del árbol reconstruye el párrafo exacto", () => {
    // La propiedad crítica: si se rompe, el artículo se pinta con palabras
    // repetidas o perdidas, y el anotador no tiene forma de saberlo.
    const casos: Mencion[][] = [
      [],
      [mk(3, 26, "Gobernador de Antioquia", "cargo")],
      [mk(3, 26, "Gobernador de Antioquia", "cargo"), mk(17, 26, "Antioquia")],
      [mk(17, 26, "Antioquia"), mk(3, 26, "Gobernador de Antioquia", "cargo")],
      [mk(0, 2, "El"), mk(27, 32, "habló")],
    ];
    for (const ms of casos) {
      expect(textoDeArbol(arbolDeParrafo(P, ms, 0))).toBe(P);
    }
  });

  it("la marca contenida queda como hija de la contenedora", () => {
    const arbol = arbolDeParrafo(P, [
      mk(3, 26, "Gobernador de Antioquia", "cargo"),
      mk(17, 26, "Antioquia"),
    ], 0);
    const marcas = arbol.filter((n) => n.clase === "marca") as NodoMarca[];
    expect(marcas).toHaveLength(1);
    expect(marcas[0].m.texto).toBe("Gobernador de Antioquia");
    const hijas = marcas[0].hijos.filter((n) => n.clase === "marca") as NodoMarca[];
    expect(hijas).toHaveLength(1);
    expect(hijas[0].m.texto).toBe("Antioquia");
  });

  it("aguanta tres niveles", () => {
    const t = "Ministerio de Transporte de Colombia";
    const ms = [mk(0, 36, t, "organizacion"), mk(0, 24, "Ministerio de Transporte", "organizacion"), mk(28, 36, "Colombia")];
    expect(textoDeArbol(arbolDeParrafo(t, ms, 0))).toBe(t);
  });

  it("ignora marcas de otros párrafos", () => {
    const otra = { ...mk(0, 2, "El"), pi: 1 };
    expect(textoDeArbol(arbolDeParrafo(P, [otra], 0))).toBe(P);
  });
});

describe("cabeAnidada", () => {
  const t = (ini: number, fin: number) => ({ pi: 0, ini, fin });

  it("acepta una marca dentro de otra", () => {
    expect(cabeAnidada(t(17, 26), [t(3, 26)])).toBe(true);
    expect(cabeAnidada(t(3, 26), [t(17, 26)])).toBe(true);
  });

  it("acepta marcas que no se tocan", () => {
    expect(cabeAnidada(t(0, 2), [t(3, 26)])).toBe(true);
  });

  it("rechaza un cruce a medias", () => {
    // Empieza dentro y acaba fuera: no se puede representar ni significa nada.
    expect(cabeAnidada(t(10, 30), [t(3, 26)])).toBe(false);
  });

  it("rechaza una marca idéntica", () => {
    expect(cabeAnidada(t(3, 26), [t(3, 26)])).toBe(false);
  });

  it("no le importan las marcas de otro párrafo", () => {
    expect(cabeAnidada(t(10, 30), [{ pi: 1, ini: 3, fin: 26 }])).toBe(true);
  });
});

describe("predicados", () => {
  it("entre dos personas ofrece las relaciones de poder", () => {
    const e = predicadosPara("persona", "persona").map((p) => p.etiqueta);
    expect(e).toContain("aliado de");
    expect(e).toContain("opositor de");
    expect(e).toContain("familiar de");
    expect(e).not.toContain("ocupa el cargo");
  });

  it("persona y cargo separa ocupar de aspirar", () => {
    const e = predicadosPara("persona", "cargo").map((p) => p.etiqueta);
    expect(e).toContain("ocupa el cargo");
    expect(e).toContain("aspira a");
    expect(e).not.toContain("familiar de");
  });

  it("un monto solo puede ir a un destino o a otro monto", () => {
    const e = predicadosPara("monto", "evento").map((p) => p.etiqueta);
    expect(e).toContain("destinado a");
    expect(e).not.toContain("ocupa el cargo");
  });

  it("nunca deja al anotador sin opciones", () => {
    // El vocabulario está incompleto por definición: bloquear sería peor.
    expect(predicadosPara("obra", "monto").length).toBeGreaterThan(0);
  });

  it("la lista filtrada cabe en las teclas 1—9", () => {
    for (const a of ["persona", "organizacion", "cargo", "lugar", "ley", "monto"]) {
      for (const b of ["persona", "organizacion", "cargo", "lugar", "ley", "monto"]) {
        expect(predicadosPara(a, b).length).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe("avisos al marcar", () => {
  it("señala el artículo en minúscula y propone el recorte", () => {
    const [a] = revisar("el Congreso", "organizacion");
    expect(a.arreglo).toBe("Congreso");
  });

  it("se calla cuando el artículo es parte del nombre", () => {
    // «La Silla Vacía», «Los Urabeños», «El Espectador» llevan el artículo dentro.
    for (const t of ["La Silla Vacía", "Los Urabeños", "El Espectador"]) {
      expect(revisar(t, "organizacion").filter((a) => a.arreglo)).toHaveLength(0);
    }
  });

  it("señala los sustantivos comunes en minúscula", () => {
    expect(revisar("gobierno", "organizacion").length).toBeGreaterThan(0);
    expect(revisar("político", "cargo").filter((a) => a.arreglo)).toHaveLength(0);
  });

  it("no molesta con los nombres propios", () => {
    for (const t of ["Montería", "Ómar Yepes", "FARC", "Ministerio de Hacienda"]) {
      expect(revisar(t, "organizacion")).toHaveLength(0);
    }
  });

  it("los cargos en minúscula son legítimos y no se avisan", () => {
    expect(revisar("senador", "cargo")).toHaveLength(0);
    expect(revisar("ministro de Hacienda", "cargo")).toHaveLength(0);
  });

  it("avisa de los tramos que parecen frases", () => {
    const a = revisar("debate en torno a la creación de un área protegida o la construcción", "evento");
    expect(a.some((x) => x.texto.includes("palabras"))).toBe(true);
  });

  it("no avisa de las cifras, que van en minúscula por naturaleza", () => {
    expect(revisar("cuarenta y ocho (48) a ciento ocho (108) meses", "monto")
      .filter((a) => !a.texto.includes("palabras"))).toHaveLength(0);
  });
});

describe("vigencia sugerida por el texto", () => {
  it("reconoce el pasado en las formas que de verdad usa la prensa política", () => {
    for (const t of [
      "el entonces ministro de Ambiente",
      "el exgobernador de Antioquia",
      "Costa fue director de la CAR",
      "el ministro saliente",
    ]) {
      expect(vigenciaSugerida(t)).toBe("pasada");
    }
  });

  it("reconoce lo anunciado pero no cumplido", () => {
    expect(vigenciaSugerida("asumirá el cargo en enero")).toBe("futura");
    expect(vigenciaSugerida("el presidente electo")).toBe("futura");
  });

  it("calla cuando no hay señal, que es lo normal", () => {
    // El presente no deja marca léxica. Por eso «vigente» es el valor por
    // defecto y no algo que haya que adivinar.
    expect(vigenciaSugerida("Carlos Costa, ministro de Ambiente")).toBeNull();
  });

  it("no confunde una palabra que empieza por «ex»", () => {
    expect(vigenciaSugerida("el experto en presupuesto")).toBeNull();
    expect(vigenciaSugerida("la exportación de café")).toBeNull();
  });
});

describe("descripciones que señalan sin nombrar", () => {
  it("reconoce el cargo que describe a alguien concreto", () => {
    expect(pareceDescripcion("Gobernador de Antioquia", "cargo")).toBe(true);
    expect(pareceDescripcion("ministro de Ambiente", "cargo")).toBe(true);
  });

  it("no marca una organización que ya lleva su nombre", () => {
    expect(pareceDescripcion("Ministerio de Hacienda", "organizacion")).toBe(false);
    expect(pareceDescripcion("Comisión Tercera", "organizacion")).toBe(false);
  });

  it("no se mete con los tipos donde la pregunta no aplica", () => {
    expect(pareceDescripcion("Gustavo Petro", "persona")).toBe(false);
    expect(pareceDescripcion("50 mil millones", "monto")).toBe(false);
  });
});
