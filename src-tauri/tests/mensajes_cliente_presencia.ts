// Genera, en stdout, los cinco mensajes salientes reales de `presencia.ts`
// (uno por línea, JSON), a partir de sus propios constructores en
// `src/lib/protocoloPresencia.ts` — no una copia escrita a mano aquí — para
// que la prueba de contrato en `servidor.rs`
// (`contrato_mensajes_cliente_coincide_con_el_deserializador`) nunca se
// desincronice de lo que el cliente manda de verdad.
//
// Se ejecuta con `node --experimental-strip-types` (Node 22+): el fichero
// importado es TypeScript sin más dependencias que tipos que se borran sin
// más, así que el borrado de tipos de Node basta, sin compilar nada.
import {
  mensajeHola, mensajeTomar, mensajeSoltar, mensajeForzar, mensajeLatido,
} from "../../src/lib/protocoloPresencia.ts";

const mensajes = [
  mensajeHola("cliente-de-prueba"),
  mensajeTomar(7, 42),
  mensajeSoltar(7, 42),
  mensajeForzar(7, 42),
  mensajeLatido(),
];

for (const m of mensajes) console.log(JSON.stringify(m));
