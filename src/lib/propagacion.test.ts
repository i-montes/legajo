import { describe, expect, it } from "vitest";
import { pareceDescripcion, vigenciaSugerida } from "./revision";
import {
  absorberSueltas, aplicarLexico, arbolDeParrafo, cabeAnidada, filasDelPanel, grupoDeLaForma,
  gruposDeAlias,
  ocurrencias, plegar,
  propagarEnDocumento, soltarAlias, textoDeArbol, unirAlias,
} from "./propagacion";
import type { NodoMarca } from "./propagacion";
import { FAMILIAS, PREDICADOS, predicadosPara, sugerirInversa } from "../contenido/tipos";
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

describe("título anotable (pi = -1)", () => {
  /* Medido sobre el oro: el 75 % de los 125 artículos tiene en el título una
     entidad ya marcada en el cuerpo y nunca ofrecida en el título. Para un
     clasificador de tokens eso enseña «Petro no es persona» cuarenta
     caracteres antes de enseñar lo contrario. Estas pruebas cubren que la
     propagación llegue también ahí, y que hacerlo no mueva ni un índice del
     cuerpo: las anotaciones ya guardadas por el usuario apuntan a `pi` 0..n
     del cuerpo, y esos números no pueden cambiar. */

  it("ocurrencias encuentra el título cuando se pasa, con pi = -1", () => {
    const tramos = ocurrencias(["Petro habló ayer."], "Petro", "Detector: Petro no llamó a la calma");
    const delTitulo = tramos.filter((t) => t.pi === -1);
    expect(delTitulo).toHaveLength(1);
    expect(delTitulo[0]).toMatchObject({ ini: 10, fin: 15 });
  });

  it("sin título no busca nada ahí: mismo comportamiento que antes de esta función existir", () => {
    expect(ocurrencias(["Petro habló ayer."], "Petro")).toHaveLength(1);
    expect(ocurrencias(["Petro habló ayer."], "Petro", null)).toHaveLength(1);
    expect(ocurrencias(["Petro habló ayer."], "Petro", "")).toHaveLength(1);
  });

  it("respeta límites de palabra en el título: «Cali» no casa dentro de «California»", () => {
    const tramos = ocurrencias(["Un viaje."], "Cali", "Inversión llega desde California");
    expect(tramos.filter((t) => t.pi === -1)).toHaveLength(0);
  });

  it("buscar en el título no desplaza los índices del cuerpo", () => {
    const parrafos = ["Primero.", "Segundo con Petro."];
    const tramos = ocurrencias(parrafos, "Petro", "Petro y su gabinete");
    const delCuerpo = tramos.filter((t) => t.pi !== -1);
    expect(delCuerpo).toEqual([{ pi: 1, ini: 12, fin: 17 }]);
  });

  it("propagarEnDocumento marca también el título, como auto = true", () => {
    const parrafos = ["Petro llegó a la reunión."];
    const nuevas = propagarEnDocumento(parrafos, "Petro", "persona", [], "Petro no llamó a la calma");
    const delTitulo = nuevas.find((n) => n.pi === -1);
    expect(delTitulo).toBeDefined();
    expect(delTitulo?.auto).toBe(true);
    expect(delTitulo?.texto).toBe("Petro");
  });

  it("propagarEnDocumento sin título no toca el título ni falla", () => {
    const nuevas = propagarEnDocumento(["Petro llegó."], "Petro", "persona", []);
    expect(nuevas.every((n) => n.pi !== -1)).toBe(true);
  });

  it("propagar al título no cambia los pi del cuerpo", () => {
    const parrafos = ["Uno.", "Dos con Petro.", "Tres."];
    const ya: Mencion[] = [{ mid: "x", pi: 1, ini: 8, fin: 13, texto: "Petro", tipo: "persona", auto: false }];
    const nuevas = propagarEnDocumento(parrafos, "Petro", "persona", ya, "Petro en el título");
    // La única marca nueva en el cuerpo, si la hay, sigue apuntando a pi = 1;
    // ninguna aparece en 0, 2 ni en ningún otro índice que no sea -1 o 1.
    for (const n of nuevas) {
      expect([1, -1]).toContain(n.pi);
    }
  });

  it("una entidad que no se propaga (monto) tampoco se propone en el título", () => {
    const nuevas = propagarEnDocumento(["Costó 50 mil millones."], "50 mil millones", "monto", [], "50 mil millones en obras");
    expect(nuevas).toHaveLength(0);
  });

  it("aplicarLexico también prende el título", () => {
    const ms = aplicarLexico(["Un artículo sobre política."], [lex("Petro", "persona")], "Petro insiste en el punto");
    const delTitulo = ms.find((m) => m.pi === -1);
    expect(delTitulo).toBeDefined();
    expect(delTitulo?.auto).toBe(true);
    expect(delTitulo?.texto).toBe("Petro");
  });

  it("aplicarLexico sin título no revienta ni marca nada con pi = -1", () => {
    const ms = aplicarLexico(["Petro habló."], [lex("Petro", "persona")]);
    expect(ms.every((m) => m.pi !== -1)).toBe(true);
    expect(ms).toHaveLength(1);
    expect(ms[0].pi).toBe(0);
  });

  it("el orden final antepone el título (pi = -1) a los párrafos del cuerpo", () => {
    const ms = aplicarLexico(["Petro llegó."], [lex("Petro", "persona")], "Petro no llamó a la calma");
    expect(ms[0].pi).toBe(-1);
    expect(ms[ms.length - 1].pi).toBe(0);
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

  it("unir una forma arrastra sus demás apariciones", () => {
    /* La persona elige dos marcas del texto, pero lo que declara es sobre la
       entidad: «Uribe es Álvaro Uribe». Dejar fuera el otro «Uribe» del
       artículo partiría en dos lo que se acaba de decir que es uno solo, y el
       panel mostraría un «Uribe» suelto al lado del grupo. */
    let ms = [m("1", "Uribe"), m("2", "Uribe"), m("3", "Álvaro Uribe")];
    ms = unirAlias(ms, "1", "3");
    expect(ms.map((x) => x.grupo)).toEqual([ms[0].grupo, ms[0].grupo, ms[0].grupo]);
  });

  it("no arrastra las cifras iguales, que no son la misma por repetirse", () => {
    let ms = [m("1", "50 mil millones", "monto"), m("2", "50 mil millones", "monto"),
              m("3", "esa partida", "monto")];
    ms = unirAlias(ms, "1", "3");
    expect(ms[1].grupo).toBeUndefined();
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
    expect(e).toContain("apoya a");
    expect(e).toContain("se opone a");
    expect(e).toContain("familiar de");
    expect(e).not.toContain("ocupa el cargo");
  });

  it("persona y cargo separa ocupar de aspirar", () => {
    const e = predicadosPara("persona", "cargo").map((p) => p.etiqueta);
    expect(e).toContain("ocupa el cargo");
    expect(e).toContain("aspira al cargo");
    expect(e).not.toContain("familiar de");
  });

  it("persona y organización hacia una norma ofrecen apoyar, impulsar u oponerse", () => {
    // «impulsa» es el acto legislativo (radicarla, redactarla, ser ponente,
    // sancionarla); «apoya a» es solo la postura declarada; hundirla o
    // archivarla es «se opone a». Las tres compiten por la misma norma.
    expect(predicadosPara("persona", "ley").map((p) => p.etiqueta)).toEqual([
      "apoya a", "se opone a", "impulsa", "vínculo sin tipo",
    ]);
    expect(predicadosPara("organizacion", "ley").map((p) => p.etiqueta)).toEqual([
      "apoya a", "se opone a", "impulsa", "vínculo sin tipo",
    ]);
  });

  it("un monto ya no tiene predicados tipados: solo queda la reserva", () => {
    // Las 27 clases finas no incluyen ningún predicado con «monto» en sus
    // extremos; lo único que encaja siempre es «vínculo sin tipo».
    const e = predicadosPara("monto", "organizacion").map((p) => p.etiqueta);
    expect(e).toEqual(["vínculo sin tipo"]);
    expect(predicadosPara("monto", "evento").map((p) => p.etiqueta)).toEqual(["vínculo sin tipo"]);
  });

  it("cuando nada tipado encaja, queda la reserva: ya no hay lista vacía", () => {
    /* Antes se devolvían los trece predicados cuando ninguno encajaba, para no
       bloquear a quien anota; luego, la lista vacía como respuesta honesta.
       Ahora «vínculo sin tipo» admite cualquier par y es la reserva: el texto
       puede afirmar un vínculo que no encaja en ninguna clase tipada, y eso
       también se anota. */
    expect(predicadosPara("obra", "monto").map((p) => p.etiqueta)).toEqual(["vínculo sin tipo"]);
    expect(predicadosPara("lugar", "persona").map((p) => p.etiqueta)).toEqual(["vínculo sin tipo"]);
  });

  it("cuando el par no encaja tipado, suele encajar al revés", () => {
    // «lugar → persona» solo tiene la reserva porque lo tipado que existe es
    // «persona ubicado en lugar». Saberlo permite proponer el intercambio.
    expect(predicadosPara("lugar", "persona").map((p) => p.etiqueta)).toEqual(["vínculo sin tipo"]);
    expect(predicadosPara("persona", "lugar").map((p) => p.etiqueta)).toContain("ubicado en");
  });

  it("sugerirInversa encuentra lo tipado que hay al invertir el par", () => {
    // «lugar, persona» no tiene nada tipado, pero al revés («persona, lugar»)
    // está «ubicado en». La reserva nunca cuenta como pista de inversión.
    const inv = sugerirInversa("lugar", "persona").map((p) => p.etiqueta);
    expect(inv).toContain("ubicado en");
    expect(inv).not.toContain("vínculo sin tipo");
  });

  it("sugerirInversa no ofrece nada cuando tampoco hay nada tipado al revés", () => {
    // Ninguno de los 27 predicados admite «obra» ni «monto»: ni derecho ni
    // al revés hay algo tipado que unir.
    expect(sugerirInversa("obra", "monto")).toEqual([]);
    expect(sugerirInversa("monto", "obra")).toEqual([]);
  });

  it("dentro de cada familia, la lista filtrada cabe en las teclas 1—9", () => {
    /* Con 27 predicados, entre dos personas encajan más de nueve; el menú
       pide entonces la familia primero. Lo que tiene que caber en 1—9 es cada
       familia por separado, y las familias mismas. */
    expect(FAMILIAS.length).toBeLessThanOrEqual(9);
    for (const a of ["persona", "organizacion", "cargo", "lugar", "ley", "monto", "obra"]) {
      for (const b of ["persona", "organizacion", "cargo", "lugar", "ley", "monto", "obra"]) {
        for (const f of FAMILIAS) {
          expect(predicadosPara(a, b).filter((p) => p.familia === f.k).length).toBeLessThanOrEqual(9);
        }
      }
    }
  });

  it("los 27 predicados tienen familia conocida y la familia se conoce", () => {
    expect(PREDICADOS.length).toBe(27);
    for (const p of PREDICADOS) expect(FAMILIAS.map((f) => f.k)).toContain(p.familia);
  });

  it("persona → organizacion ofrece «trabaja en», «miembro de» y «estudió en»", () => {
    expect(predicadosPara("persona", "organizacion").map((p) => p.etiqueta)).toEqual([
      "trabaja en", "dirige", "miembro de", "estudió en", "fundó", "propietario de", "contrató a",
      "financia a", "apoya a", "se opone a", "investigado por", "acusado por", "condenado por", "vínculo sin tipo",
    ]);
  });

  it("el parentesco concreto y el genérico conviven", () => {
    const e = predicadosPara("persona", "persona").map((p) => p.etiqueta);
    for (const x of ["cónyuge de", "hijo de", "hermano de", "familiar de"]) expect(e).toContain(x);
    expect(e).toContain("sucedió a");
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
    const a = revisar("debate en torno a la creación de un área protegida o la construcción", "obra");
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

describe("filasDelPanel", () => {
  const m = (mid: string, texto: string, tipo = "persona", extra: Partial<Mencion> = {}): Mencion =>
    ({ mid, pi: 0, ini: 0, fin: 1, texto, tipo, auto: false, ...extra });

  it("junta las repeticiones de una misma forma en una fila", () => {
    const filas = filasDelPanel([m("1", "Santos"), m("2", "Santos"), m("3", "Petro")], "persona");
    expect(filas.map((f) => f.texto)).toEqual(["Santos", "Petro"]);
    expect(filas[0].mids).toEqual(["1", "2"]);
  });

  it("deja fuera las menciones de otro tipo", () => {
    const filas = filasDelPanel([m("1", "Santos"), m("2", "Cambio Radical", "organizacion")], "persona");
    expect(filas.map((f) => f.texto)).toEqual(["Santos"]);
  });

  it("dos formas unidas dan una sola fila, encabezada por la canónica", () => {
    const ms = unirAlias([m("1", "Uribe"), m("2", "Álvaro Uribe")], "1", "2");
    const filas = filasDelPanel(ms, "persona");
    expect(filas).toHaveLength(1);
    expect(filas[0].texto).toBe("Álvaro Uribe");
  });

  it("la fila unida cuenta las menciones de todas sus formas", () => {
    /* «Uribe ×2» y «Álvaro Uribe» unidas son una entidad con tres menciones:
       que el panel siga diciendo 1 y 2 por separado es justo lo que la unión
       venía a arreglar. */
    let ms = [m("1", "Uribe"), m("2", "Uribe"), m("3", "Álvaro Uribe")];
    ms = unirAlias(ms, "1", "3");
    const [fila] = filasDelPanel(ms, "persona");
    expect([...fila.mids].sort()).toEqual(["1", "2", "3"]);
  });

  it("lista los subnombres aparte, sin repetir la canónica", () => {
    const ms = unirAlias([m("1", "Uribe"), m("2", "Álvaro Uribe")], "1", "2");
    const [fila] = filasDelPanel(ms, "persona");
    expect(fila.alias.map((a) => a.texto)).toEqual(["Uribe"]);
  });

  it("cada subnombre carga sus menciones, para poder soltarlo solo a él", () => {
    let ms = [m("1", "Uribe"), m("2", "Uribe"), m("3", "Álvaro Uribe")];
    ms = unirAlias(ms, "1", "3");
    const [fila] = filasDelPanel(ms, "persona");
    expect(fila.alias[0]).toEqual({ texto: "Uribe", mids: ["1", "2"] });
  });

  it("una fila sin unir no tiene subnombres", () => {
    expect(filasDelPanel([m("1", "Santos")], "persona")[0].alias).toEqual([]);
  });

  it("no arrastra a la fila la mención de otro tipo que comparte grupo", () => {
    /* Un cargo unido a una persona es un vínculo legítimo, pero cada tipo
       cuenta lo suyo: si el cargo entrara en la fila de persona, la cifra de la
       cabecera dejaría de cuadrar con lo que está pintado en el texto. */
    const ms = unirAlias(
      [m("1", "Ministro de Hacienda", "cargo"), m("2", "Alberto Carrasquilla")],
      "1", "2"
    );
    const [fila] = filasDelPanel(ms, "persona");
    expect(fila.mids).toEqual(["2"]);
    expect(fila.alias).toEqual([]);
  });

  it("dentro del cargo, el grupo mixto deja su propia fila", () => {
    const ms = unirAlias(
      [m("1", "Ministro de Hacienda", "cargo"), m("2", "Alberto Carrasquilla")],
      "1", "2"
    );
    expect(filasDelPanel(ms, "cargo").map((f) => f.texto)).toEqual(["Ministro de Hacienda"]);
  });

  it("basta con que una forma señale sin nombrar para que la fila lo diga", () => {
    const ms = unirAlias(
      [m("1", "la cooperativa", "organizacion", { designa: true }), m("2", "Coogranada", "organizacion")],
      "1", "2"
    );
    expect(filasDelPanel(ms, "organizacion")[0].designa).toBe(true);
  });

  it("los montos no se juntan por texto, porque dos cifras iguales no son la misma", () => {
    const filas = filasDelPanel([m("1", "50 mil millones", "monto"), m("2", "50 mil millones", "monto")], "monto");
    expect(filas).toHaveLength(2);
  });

  it("pero un monto unido a mano sí se junta: ahí lo dijo la persona", () => {
    const ms = unirAlias([m("1", "50 mil millones", "monto"), m("2", "esa suma", "monto")], "1", "2");
    expect(filasDelPanel(ms, "monto")).toHaveLength(1);
  });
});

describe("grupoDeLaForma", () => {
  const m = (mid: string, texto: string, extra: Partial<Mencion> = {}): Mencion =>
    ({ mid, pi: 0, ini: 0, fin: 1, texto, tipo: "persona", auto: false, ...extra });

  it("devuelve el grupo al que ya pertenece esa forma", () => {
    const ms = [m("1", "Uribe", { grupo: "c:persona:alvaro uribe" })];
    expect(grupoDeLaForma(ms, "Uribe", "persona")).toBe("c:persona:alvaro uribe");
  });

  it("no inventa grupo cuando la forma no aparece", () => {
    const ms = [m("1", "Uribe", { grupo: "c:persona:alvaro uribe" })];
    expect(grupoDeLaForma(ms, "Petro", "persona")).toBeUndefined();
  });

  it("no hereda de una forma suelta", () => {
    expect(grupoDeLaForma([m("1", "Uribe")], "Uribe", "persona")).toBeUndefined();
  });

  it("no cruza tipos: el mismo texto en otro tipo es otra cosa", () => {
    const ms = [m("1", "Presidencia", { tipo: "cargo", grupo: "c:cargo:presidencia" })];
    expect(grupoDeLaForma(ms, "Presidencia", "organizacion")).toBeUndefined();
  });

  it("pliega tildes y caja, como la propagación", () => {
    /* La propagación marca «URIBE» de un ladillo al propagar «Uribe»: si para
       heredar el grupo hiciera falta que coincidiera carácter a carácter, esa
       marca nacería suelta justo por venir en versales. */
    const ms = [m("1", "Uribe", { grupo: "c:persona:alvaro uribe" })];
    expect(grupoDeLaForma(ms, "URIBE", "persona")).toBe("c:persona:alvaro uribe");
  });

  it("ignora el nulo de una que se soltó a mano y toma el grupo que sí hay", () => {
    const ms = [m("1", "Uribe", { grupo: null }), m("2", "Uribe", { grupo: "c:persona:alvaro uribe" })];
    expect(grupoDeLaForma(ms, "Uribe", "persona")).toBe("c:persona:alvaro uribe");
  });
});

describe("propagar dentro de un grupo ya existente", () => {
  it("lo propagado entra en el grupo de su forma, no como entidad aparte", () => {
    /* El extractor se dejó una aparición y la persona la marca a mano. Si nace
       huérfana, el panel muestra un «Uribe» suelto al lado de «Álvaro Uribe» y
       parece que la marca no se hizo. */
    const parrafos = ["Uribe habló hoy.", "Después Uribe calló."];
    const existentes: Mencion[] = [
      { mid: "1", pi: 0, ini: 0, fin: 5, texto: "Uribe", tipo: "persona", auto: false,
        grupo: "c:persona:alvaro uribe" },
    ];
    const nuevas = propagarEnDocumento(parrafos, "Uribe", "persona", existentes);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].grupo).toBe("c:persona:alvaro uribe");
  });

  it("sin grupo previo, lo propagado sigue naciendo suelto", () => {
    const nuevas = propagarEnDocumento(["Petro habló.", "Petro calló."], "Petro", "persona", []);
    expect(nuevas.every((n) => !n.grupo)).toBe(true);
  });
});

describe("absorberSueltas", () => {
  const m = (mid: string, texto: string, extra: Partial<Mencion> = {}): Mencion =>
    ({ mid, pi: 0, ini: 0, fin: 1, texto, tipo: "persona", auto: false, ...extra });

  it("mete en el grupo la mención suelta cuya forma ya está dentro", () => {
    /* El caso real: el extractor se dejó una aparición, la persona la marcó a
       mano en una sesión anterior y quedó guardada fuera del grupo. Al abrir el
       artículo se ve como una entidad más, y nada dice que sea la misma. */
    const ms = [
      m("1", "Álvaro Uribe", { grupo: "c:persona:alvaro uribe" }),
      m("2", "Uribe", { grupo: "c:persona:alvaro uribe" }),
      m("3", "Uribe"),
    ];
    expect(absorberSueltas(ms)[2].grupo).toBe("c:persona:alvaro uribe");
  });

  it("deja en paz a las que no tienen adónde entrar", () => {
    const ms = [m("1", "Uribe", { grupo: "c:persona:alvaro uribe" }), m("2", "Petro")];
    expect(absorberSueltas(ms)[1].grupo).toBeFalsy();
  });

  it("no cruza tipos", () => {
    const ms = [
      m("1", "Presidencia", { tipo: "cargo", grupo: "c:cargo:presidencia" }),
      m("2", "Presidencia", { tipo: "organizacion" }),
    ];
    expect(absorberSueltas(ms)[1].grupo).toBeFalsy();
  });

  it("devuelve el mismo arreglo cuando no hay nada que absorber", () => {
    // Abrir un artículo no debe marcarlo como cambiado y disparar un guardado.
    const ms = [m("1", "Uribe", { grupo: "g1" }), m("2", "Petro")];
    expect(absorberSueltas(ms)).toBe(ms);
  });
});
