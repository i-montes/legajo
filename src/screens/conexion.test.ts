import { describe, expect, it } from "vitest";
import { puedeComprobar, puedeConectar } from "./Conexion";

/* Los dos cierres de la pantalla de conexión. Existen como función aparte, y no
   solo dentro del `disabled` de su botón, porque el fallo que los trajo fue
   justamente ese: el botón sí comprobaba el correo y la tecla Enter no, así que
   pulsar Enter en la dirección dejaba pasar a pedir la contraseña sin correo, y
   allí «Comprobar y guardar» no hacía nada —la comprobación se iba en silencio
   por falta de un dato que ya no se podía escribir en ninguna parte—. */
describe("los cierres de la pantalla de conexión", () => {
  it("no deja conectar sin los dos datos", () => {
    expect(puedeConectar("tumedio.co", "tu@medio.co")).toBe(true);
    expect(puedeConectar("tumedio.co", "")).toBe(false);
    expect(puedeConectar("tumedio.co", "   ")).toBe(false);
    expect(puedeConectar("", "tu@medio.co")).toBe(false);
  });

  it("no deja comprobar la contraseña sin correo: la petición de prueba lleva los dos", () => {
    expect(puedeComprobar("tu@medio.co", "abcd efgh")).toBe(true);
    expect(puedeComprobar("", "abcd efgh")).toBe(false);
    expect(puedeComprobar("   ", "abcd efgh")).toBe(false);
    expect(puedeComprobar("tu@medio.co", "")).toBe(false);
  });
});
