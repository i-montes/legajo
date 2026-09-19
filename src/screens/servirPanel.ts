/* La orquesta detrás del interruptor de `Servir.tsx`, separada del componente
 * para poder probarla con dobles —tal como pide el encargo— sin tener que
 * montar React ni depender de que `servir_iniciar` / `servir_detener` ya
 * existan del lado de Rust.
 *
 * El orden es la parte que importa: encender vacía lo pendiente y SOLO
 * ENTONCES marca la ventana como no escritora; apagar hace lo contrario, sin
 * nada que vaciar, porque mientras se servía esta ventana no escribía nada.
 */
import type { EstadoServidor } from "../types";

export interface DependenciasServir {
  servirIniciar: (puerto: number) => Promise<EstadoServidor>;
  servirDetener: () => Promise<EstadoServidor>;
  activarExclusividad: () => Promise<void>;
  desactivarExclusividad: () => void;
}

/** Puerto 0: «elige uno libre», tal como dice el contrato de `servir_iniciar`. */
export async function encenderServidor(dep: DependenciasServir): Promise<EstadoServidor> {
  const estado = await dep.servirIniciar(0);
  // Solo tras confirmar el encendido se vacía lo pendiente y se corta la
  // escritura local. Si `servirIniciar` fallara, esta línea no se alcanza y
  // la ventana sigue anotando como si nada — que es lo correcto: no hay
  // ningún servidor al que temerle todavía.
  await dep.activarExclusividad();
  return estado;
}

export async function apagarServidor(dep: DependenciasServir): Promise<EstadoServidor> {
  const estado = await dep.servirDetener();
  dep.desactivarExclusividad();
  return estado;
}
