/* El formulario para trabajar contra la base de otra máquina.
 *
 * Vive aparte de `Conexion.tsx` —que ya tiene 600 líneas con su propio flujo
 * local— y se monta dentro de ella cuando la persona elige «Conectarme a
 * otra máquina para corregir».
 *
 * La validación es la puerta: no se guarda nada hasta que `GET /api/salud`
 * responde bien, y solo entonces aparece el botón que de verdad activa el
 * modo remoto.
 */
import { useState } from "react";
import { Boton, Campo, Glifo } from "../ui";
import {
  activarModoRemoto, comprobarSalud, normalizarToken, parsearCadenaConexion,
  type ConexionRemota as DatosConexion, type ResultadoSalud,
} from "../lib/conexionRemota";

export default function ConexionRemota({ onVolver }: { onVolver: () => void }) {
  const [cadena, setCadena] = useState("");
  const [direccion, setDireccion] = useState("");
  const [puerto, setPuerto] = useState("");
  const [token, setToken] = useState("");
  const [validando, setValidando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSalud | null>(null);
  const [conectando, setConectando] = useState(false);

  /* Pegar la cadena entera —dirección, puerto y token juntos, tal como la
     copia el panel de «servir» de la otra máquina— rellena los tres campos
     de una vez. Si no se reconoce, se deja tal cual: puede que la persona
     solo esté escribiendo algo suyo ahí. */
  const alPegarCadena = (v: string) => {
    setCadena(v);
    const c = parsearCadenaConexion(v);
    if (c) {
      setDireccion(c.direccion);
      setPuerto(String(c.puerto));
      // El token va normalizado ya al guardarse en el estado: pegar la
      // cadena entera no debe dejar minúsculas o espacios colados solo
      // porque venían así en lo que se copió del otro computador.
      setToken(normalizarToken(c.token));
      setResultado(null);
    }
  };

  const puertoNum = Number(puerto);
  const puedeValidar =
    direccion.trim() !== "" && token.trim() !== "" &&
    Number.isInteger(puertoNum) && puertoNum > 0 && puertoNum < 65536;

  async function validar() {
    if (!puedeValidar) return;
    setValidando(true);
    setResultado(null);
    const datos: DatosConexion = { direccion: direccion.trim(), puerto: puertoNum, token: normalizarToken(token) };
    const r = await comprobarSalud(datos);
    setResultado(r);
    setValidando(false);
  }

  function entrar() {
    if (!resultado?.ok) return;
    setConectando(true);
    activarModoRemoto({ direccion: direccion.trim(), puerto: puertoNum, token: normalizarToken(token) });
    // No hace falta apagar `conectando`: en cuanto se activa el modo remoto,
    // la app entera cambia a la pantalla de revisión y este formulario deja
    // de existir.
  }

  return (
    <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
      <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.65, color: "var(--t2)", maxWidth: "44ch" }}>
        Para corregir desde aquí contra la base de otra máquina, en esa máquina hay que encender el
        servidor —panel «Servir a otro computador»— y copiar su cadena de conexión.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Campo
          etiqueta="Cadena de conexión (opcional)"
          ayuda="Pégala aquí y los tres campos de abajo se rellenan solos."
          value={cadena}
          onChange={alPegarCadena}
          placeholder="legajo://192.168.1.23:4177/…"
          mono
        />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          <Campo
            etiqueta="Dirección"
            ayuda="La IP local o el dominio de la otra máquina."
            value={direccion}
            onChange={(v) => { setDireccion(v); setResultado(null); }}
            placeholder="192.168.1.23"
          />
          <Campo
            etiqueta="Puerto"
            value={puerto}
            onChange={(v) => { setPuerto(v.replace(/[^\d]/g, "")); setResultado(null); }}
            placeholder="4177"
          />
        </div>
        <Campo
          etiqueta="Token"
          ayuda="Lo muestra el panel de «servir» en la otra máquina."
          value={token}
          onChange={(v) => { setToken(normalizarToken(v)); setResultado(null); }}
          placeholder="token"
          mono
          onEnter={validar}
        />
      </div>

      <div style={{ height: 18 }} />

      {!resultado && (
        <Boton onClick={validar} disabled={!puedeValidar || validando}>
          {validando ? "Probando la conexión…" : "Probar la conexión"}
        </Boton>
      )}

      {resultado && !resultado.ok && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "baseline", marginBottom: 10 }}>
            <Glifo estado="error" size={11} />
            <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--t1)", maxWidth: "44ch" }}>{resultado.mensaje}</span>
          </div>
          <Boton variante="secundario" onClick={validar} disabled={validando}>Reintentar</Boton>
        </div>
      )}

      {resultado?.ok && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "baseline", marginBottom: 14 }}>
            <Glifo estado="exito" size={11} />
            <span style={{ fontSize: 13.5, color: "var(--t1)" }}>
              Es Legajo, versión <strong style={{ fontWeight: 500 }}>{resultado.salud.version}</strong>
              {" "}· {resultado.salud.lotes} {resultado.salud.lotes === 1 ? "lote" : "lotes"}
            </span>
          </div>
          <Boton onClick={entrar} disabled={conectando}>
            {conectando ? "Entrando…" : "Trabajar contra esta base"}
          </Boton>
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--borde)" }}>
        <Boton variante="enlace" onClick={onVolver}>trabajar en esta máquina, mejor</Boton>
      </div>
    </div>
  );
}
