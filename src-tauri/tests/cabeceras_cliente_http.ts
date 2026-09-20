// Extrae, del código fuente REAL del cliente —no de una lista copiada a
// mano aquí—, los nombres de todas las cabeceras que puede mandar en una
// petición HTTP contra este mismo servidor Rust: las de `llamarRemoto`
// (`src/lib/ipc.ts`, que sirve a los ~55 comandos por red) y las de
// `comprobarSalud` (`src/lib/conexionRemota.ts`, el `GET /api/salud` de la
// pantalla de conexión).
//
// Por qué no es un puente como `mensajes_cliente_presencia.ts` (que
// EJECUTA el código real y captura su salida): esas dos funciones no son
// puras. `llamarRemoto` lee `identidad` de `presencia.ts`, un singleton de
// módulo que arranca un WebSocket en cuanto se importa y solo rellena esa
// identidad al recibir una `bienvenida` real del servidor; `comprobarSalud`
// hace un `fetch` de verdad. Ejecutarlas de verdad exigiría fabricar un
// WebSocket, un `fetch` y un `localStorage` de mentira y esperar a que la
// máquina de estados interna llegue al punto exacto en el que manda la
// cabecera condicional — mucho aparato para lo que hace falta.
//
// En su lugar, este script analiza el AST real (con el propio compilador de
// TypeScript, que ya es dependencia del proyecto) de esos dos ficheros:
// busca las llamadas a `fetch(..., { ...opciones })`, entra en su propiedad
// `headers`, y recoge el nombre de toda propiedad de objeto que encuentre
// —incluida la de un `...(condición ? {"X-Legajo-Sesion": ...} : {})»,
// mirando dentro de spreads, condicionales, `&&`/`||` y paréntesis—. Si
// mañana alguien añade una cabecera nueva a cualquiera de las dos llamadas,
// este script la recoge sin que nadie tenga que acordarse de tocar una
// lista aparte, que es justo el tipo de olvido que causó el fallo de CORS
// que esta prueba existe para no repetir.
//
// Se ejecuta con `node --experimental-strip-types` (Node 22+), igual que
// `mensajes_cliente_presencia.ts`.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const libDir = join(aqui, "..", "..", "src", "lib");

function nombresDeObjeto(obj: ts.ObjectLiteralExpression, nombres: Set<string>): void {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const nombre = prop.name;
      if (nombre && (ts.isIdentifier(nombre) || ts.isStringLiteral(nombre))) {
        nombres.add(nombre.text);
      }
    } else if (ts.isSpreadAssignment(prop)) {
      buscarObjetosEnExpresion(prop.expression, nombres);
    }
  }
}

function buscarObjetosEnExpresion(expr: ts.Expression, nombres: Set<string>): void {
  if (ts.isObjectLiteralExpression(expr)) {
    nombresDeObjeto(expr, nombres);
  } else if (ts.isConditionalExpression(expr)) {
    buscarObjetosEnExpresion(expr.whenTrue, nombres);
    buscarObjetosEnExpresion(expr.whenFalse, nombres);
  } else if (ts.isParenthesizedExpression(expr)) {
    buscarObjetosEnExpresion(expr.expression, nombres);
  } else if (ts.isBinaryExpression(expr)) {
    buscarObjetosEnExpresion(expr.left, nombres);
    buscarObjetosEnExpresion(expr.right, nombres);
  }
}

/** Todas las cabeceras que aparecen en la opción `headers` de cualquier
 *  llamada a `fetch(...)` del fichero dado. */
function cabecerasDeFetch(ruta: string): Set<string> {
  const texto = readFileSync(ruta, "utf8");
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nombres = new Set<string>();

  function visitar(nodo: ts.Node): void {
    if (
      ts.isCallExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      nodo.expression.text === "fetch"
    ) {
      const opciones = nodo.arguments[1];
      if (opciones && ts.isObjectLiteralExpression(opciones)) {
        for (const prop of opciones.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === "headers"
          ) {
            buscarObjetosEnExpresion(prop.initializer, nombres);
          }
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  }

  visitar(fuente);
  return nombres;
}

const todas = new Set<string>();
for (const nombre of cabecerasDeFetch(join(libDir, "ipc.ts"))) todas.add(nombre);
for (const nombre of cabecerasDeFetch(join(libDir, "conexionRemota.ts"))) todas.add(nombre);

// Salen ordenadas para que la salida sea determinista entre corridas.
console.log(JSON.stringify([...todas].sort()));
