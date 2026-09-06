/* Pantalla de espera con los pasos que de verdad se están dando.
 *
 * Una espera muda se siente rota aunque no lo esté: quien mira no distingue
 * «tarda» de «se colgó», y la única forma de distinguirlo es decir en qué va.
 *
 * La regla de esta pantalla es que los pasos sean los reales. Marcar como hecho
 * algo que no ha ocurrido convierte la pantalla en una animación decorativa, y
 * la primera vez que algo falle a mitad, el ✓ de más será una mentira.
 */
import { Latido, Rotulo } from "./index";

export interface PasoCarga {
  /** Qué se está haciendo, en primera persona del programa. */
  texto: string;
  /** Detalle que solo se sabe al ejecutarlo: la ventana de fechas, el modelo. */
  detalle?: string;
}

export default function Cargando({
  titulo,
  rotulo,
  pasos,
  actual,
  nota,
}: {
  titulo: string;
  rotulo?: string;
  pasos: PasoCarga[];
  /** Índice del paso en curso. Los anteriores se dan por hechos; los
   *  posteriores, por pendientes. */
  actual: number;
  nota?: string;
}) {
  return (
    <div>
      {rotulo && <Rotulo style={{ marginBottom: 12 }}>{rotulo}</Rotulo>}
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
        <Latido />
        <span className="t-cuerpo" style={{ color: "var(--t1)" }}>{titulo}</span>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
        {pasos.map((p, i) => {
          const hecho = i < actual;
          const ahora = i === actual;
          return (
            <li
              key={p.texto}
              style={{
                display: "flex", gap: 10, alignItems: "baseline", fontSize: 13,
                lineHeight: 1.55,
                color: ahora ? "var(--t1)" : hecho ? "var(--t2)" : "var(--t3)",
              }}
            >
              <span
                aria-hidden
                style={{ fontSize: 11, width: 12, flex: "0 0 auto", color: hecho ? "var(--exito)" : ahora ? "var(--acento)" : "var(--t3)" }}
              >
                {hecho ? "✓" : ahora ? "●" : "○"}
              </span>
              <span>
                {p.texto}
                {p.detalle && (
                  <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11.5, marginLeft: 7 }}>
                    {p.detalle}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {nota && (
        <p className="t-menor" style={{ color: "var(--t3)", margin: "18px 0 0", maxWidth: "48ch", lineHeight: 1.65 }}>
          {nota}
        </p>
      )}
    </div>
  );
}
