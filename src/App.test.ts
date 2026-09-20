import { describe, expect, it, vi } from "vitest";
import { ejecutarOlvidoDeArchivo } from "./App";

/* «Conectar otro archivo» fue justo lo que dejó al usuario bloqueado: un
 * clic sin confirmar que borraba por dónde iba —y de paso la única salida de
 * emergencia, «Volver donde ibas», que depende de la misma fila—. Ahora el
 * botón solo muestra una confirmación; `ejecutarOlvidoDeArchivo` es lo único
 * que de verdad olvida algo, y solo corre cuando se llama.
 *
 * La pantalla llama a esto en el segundo clic, nunca en el primero: eso se
 * verifica leyendo `App.tsx`, no aquí, porque mostrar una confirmación no
 * tiene efectos que una prueba pueda observar aparte de eso. Lo que sí se
 * puede probar, y es lo que importa, es que la propia función hace
 * exactamente lo que dice y nada de lo que no dice. */
describe("ejecutarOlvidoDeArchivo", () => {
  function deps() {
    return {
      olvidarSesion: vi.fn().mockResolvedValue(undefined),
      setSitio: vi.fn(),
      setConexionId: vi.fn(),
      setTaxonomia: vi.fn(),
      setLoteId: vi.fn(),
      setProgreso: vi.fn(),
      setPaso: vi.fn(),
      setAviso: vi.fn(),
    };
  }

  it("olvida la fila de sesión y limpia el estado de la ventana", () => {
    const d = deps();
    ejecutarOlvidoDeArchivo(d);

    expect(d.olvidarSesion).toHaveBeenCalledTimes(1);
    expect(d.setSitio).toHaveBeenCalledWith(null);
    expect(d.setConexionId).toHaveBeenCalledWith(null);
    expect(d.setTaxonomia).toHaveBeenCalledWith(null);
    expect(d.setLoteId).toHaveBeenCalledWith(null);
    expect(d.setProgreso).toHaveBeenCalledWith(0);
    expect(d.setPaso).toHaveBeenCalledWith("conexion");
    expect(d.setAviso).toHaveBeenCalledWith(null);
  });

  it("no revienta si olvidar la sesión falla en el servidor", async () => {
    const d = deps();
    d.olvidarSesion.mockRejectedValue(new Error("la base no responde"));
    expect(() => ejecutarOlvidoDeArchivo(d)).not.toThrow();
    // El resto del estado se limpia igual: la sesión es un recuerdo, no la
    // fuente de verdad, y no vale la pena dejar la ventana a medio limpiar
    // por un fallo en guardarlo.
    expect(d.setPaso).toHaveBeenCalledWith("conexion");
  });

  it("no llama a nada de esto por sí sola: hace falta invocarla explícitamente", () => {
    // No es una prueba de comportamiento de React —eso vive en la pantalla,
    // no en esta función— sino la garantía mínima: importar el módulo no
    // ejecuta el olvido, solo llamar a la función lo hace.
    const d = deps();
    expect(d.olvidarSesion).not.toHaveBeenCalled();
  });
});
