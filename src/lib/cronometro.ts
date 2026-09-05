import { useEffect, useRef, useState } from "react";

/* Cronómetro de anotación.
 *
 * La cifra que produce —minutos por artículo— es el resultado de toda la fase,
 * así que el reloj tiene que medir trabajo y no presencia. Se detiene solo
 * cuando la ventana pierde el foco y cuando pasa un rato sin que nadie toque
 * nada; sin eso, un artículo abierto mientras se hace otra cosa registra
 * cuarenta y cinco minutos y desplaza la mediana de toda la muestra.
 */

/** Sin interacción durante esto, se entiende que nadie está anotando. */
export const INACTIVIDAD_MS = 60_000;

export type EstadoReloj = "corriendo" | "pausado" | "inactivo" | "detenido";

export function useCronometro(activoInicial = true) {
  const [segundos, setSegundos] = useState(0);
  const [correr, setCorrer] = useState(activoInicial);
  const [visible, setVisible] = useState(true);
  const [inactivo, setInactivo] = useState(false);
  const ultimoToque = useRef(Date.now());

  // Cualquier señal de que hay alguien delante reanuda la cuenta.
  useEffect(() => {
    const toque = () => {
      ultimoToque.current = Date.now();
      setInactivo(false);
    };
    const eventos = ["mousedown", "keydown", "mousemove", "wheel", "touchstart"];
    for (const e of eventos) window.addEventListener(e, toque, { passive: true });
    return () => { for (const e of eventos) window.removeEventListener(e, toque); };
  }, []);

  // Cambiar de ventana o de pestaña no es anotar.
  useEffect(() => {
    const cambio = () => setVisible(!document.hidden);
    const fuera = () => setVisible(false);
    const dentro = () => { setVisible(true); ultimoToque.current = Date.now(); setInactivo(false); };
    document.addEventListener("visibilitychange", cambio);
    window.addEventListener("blur", fuera);
    window.addEventListener("focus", dentro);
    return () => {
      document.removeEventListener("visibilitychange", cambio);
      window.removeEventListener("blur", fuera);
      window.removeEventListener("focus", dentro);
    };
  }, []);

  const contando = correr && visible && !inactivo;

  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - ultimoToque.current > INACTIVIDAD_MS) setInactivo(true);
      if (correr && !document.hidden && Date.now() - ultimoToque.current <= INACTIVIDAD_MS) {
        setSegundos((s) => s + 1);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [correr]);

  const estado: EstadoReloj = !correr
    ? "detenido"
    : !visible
    ? "pausado"
    : inactivo
    ? "inactivo"
    : "corriendo";

  return {
    segundos,
    estado,
    contando,
    poner: (s: number) => setSegundos(s),
    alternar: () => { setCorrer((v) => !v); ultimoToque.current = Date.now(); setInactivo(false); },
    reiniciar: (s = 0) => { setSegundos(s); setCorrer(true); ultimoToque.current = Date.now(); setInactivo(false); },
  };
}

export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

export const ETIQUETA_RELOJ: Record<EstadoReloj, string> = {
  corriendo: "midiendo",
  pausado: "en pausa · ventana sin foco",
  inactivo: "en pausa · sin actividad",
  detenido: "detenido",
};
