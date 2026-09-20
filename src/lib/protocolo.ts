/* El sobre `{"ok": ...}` / `{"error": ...}` en el que el servidor envuelve
 * toda respuesta de la API HTTP —tanto `POST /api/<comando>` como
 * `GET /api/salud`—. Vive en su propio módulo, sin depender de `ipc.ts` ni
 * de `conexionRemota.ts`, precisamente porque los dos lo necesitan: uno
 * como el otro tienen que estar de acuerdo en qué cuenta como «una
 * respuesta de Legajo bien formada», o vuelve a pasar lo que pasó con
 * `comprobarSalud`, que validaba a mano y con un criterio distinto del de
 * `llamarRemoto`.
 */
export type Desenvuelto =
  | { ok: true; valor: unknown }
  | { ok: false; error?: string };

export function desenvolverOk(cuerpo: unknown): Desenvuelto {
  if (cuerpo && typeof cuerpo === "object" && "error" in cuerpo) {
    return { ok: false, error: String((cuerpo as { error: unknown }).error) };
  }
  if (cuerpo && typeof cuerpo === "object" && "ok" in cuerpo) {
    return { ok: true, valor: (cuerpo as { ok: unknown }).ok };
  }
  return { ok: false };
}
