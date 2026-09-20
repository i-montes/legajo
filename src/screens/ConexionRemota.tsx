/* El formulario para trabajar contra la base de otra máquina.
 *
 * Vive aparte de `Conexion.tsx` —que ya tiene 600 líneas con su propio flujo
 * local— y se monta dentro de ella cuando la persona elige «Conectarme a
 * otra máquina para corregir».
 *
 * La validación es la puerta: no se guarda nada hasta que `GET /api/salud`
 * responde bien, y solo entonces aparece el botón que de verdad activa el
 * modo remoto. Eso vale igual para una conexión recién tecleada que para
 * una guardada de una vez anterior: un clic en una de la lista de arriba
 * vuelve a pasar por esa misma comprobación antes de entrar, nunca se la
 * salta.
 */
import { useState } from "react";
import { Boton, Campo, Glifo, Rotulo } from "../ui";
import {
  activarModoRemoto, comprobarSalud, entrarConexionGuardada, eliminarConexionGuardada,
  normalizarToken, parsearCadenaConexion, useConexionesGuardadas,
  type ConexionGuardada, type ConexionRemota as DatosConexion, type ResultadoSalud,
} from "../lib/conexionRemota";

/** «Hace 3 minutos», «ayer», «hace 2 semanas»… nada exacto: lo único que
 *  importa aquí es distinguir «esta la usé hace un rato» de «esta hace
 *  tiempo que no la toco», no la hora exacta. */
function haceCuanto(epochMs: number): string {
  const segundos = Math.round((Date.now() - epochMs) / 1000);
  if (segundos < 60) return "hace un momento";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.round(meses / 12);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}

/** Una conexión guardada, en la lista de acceso rápido. Un clic prueba la
 *  conexión de verdad —nunca entra a ciegas— y solo si va bien se activa el
 *  modo remoto; si falla, se ve el motivo aquí mismo y la entrada no se
 *  toca: seguirá disponible para reintentar o para borrarla a mano. */
function FilaGuardada({ g }: { g: ConexionGuardada }) {
  const [validando, setValidando] = useState(false);
  const [fallo, setFallo] = useState<Extract<ResultadoSalud, { ok: false }> | null>(null);

  async function entrar() {
    setFallo(null);
    setValidando(true);
    const r = await entrarConexionGuardada(g);
    if (!r.ok) {
      setFallo(r);
      setValidando(false);
    }
    // Si fue bien, no hace falta apagar `validando`: activar el modo remoto
    // cambia de pantalla entera y esta fila deja de existir.
  }

  return (
    <div style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: "11px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={entrar}
          disabled={validando}
          style={{
            flex: 1, textAlign: "left", background: "transparent", border: 0, padding: 0,
            fontFamily: "var(--font-sans)", cursor: validando ? "default" : "pointer",
          }}
        >
          <div style={{ fontSize: 13.5, color: "var(--t1)" }}>
            {g.nombre
              ? <>{g.nombre} <span style={{ color: "var(--t3)" }}>· {g.direccion}:{g.puerto}</span></>
              : <>{g.direccion}:{g.puerto}</>}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 2 }}>
            {validando ? "Probando la conexión…" : `Usada ${haceCuanto(g.ultimoUso)}`}
          </div>
        </button>
        <Boton variante="texto" onClick={() => eliminarConexionGuardada(g.id)} disabled={validando}>
          borrar
        </Boton>
      </div>
      {fallo && (
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 10 }}>
          <Glifo estado="error" size={10} />
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t2)" }}>{fallo.mensaje}</span>
        </div>
      )}
    </div>
  );
}

export default function ConexionRemota({ onVolver }: { onVolver: () => void }) {
  const guardadas = useConexionesGuardadas();

  const [cadena, setCadena] = useState("");
  const [direccion, setDireccion] = useState("");
  const [puerto, setPuerto] = useState("");
  const [token, setToken] = useState("");
  const [nombre, setNombre] = useState("");
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
    activarModoRemoto(
      { direccion: direccion.trim(), puerto: puertoNum, token: normalizarToken(token) },
      nombre.trim() || undefined,
    );
    // No hace falta apagar `conectando`: en cuanto se activa el modo remoto,
    // la app entera cambia a la pantalla de revisión y este formulario deja
    // de existir.
  }

  return (
    <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
      {guardadas.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <Rotulo style={{ marginBottom: 10 }}>Conexiones usadas antes</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {guardadas.map((g) => <FilaGuardada key={g.id} g={g} />)}
          </div>
        </div>
      )}

      <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.65, color: "var(--t2)", maxWidth: "44ch" }}>
        {guardadas.length > 0
          ? "O conéctate a una máquina nueva: en ella hay que encender el servidor —panel «Servir a otro computador»— y copiar su cadena de conexión."
          : "Para corregir desde aquí contra la base de otra máquina, en esa máquina hay que encender el servidor —panel «Servir a otro computador»— y copiar su cadena de conexión."}
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
        <Campo
          etiqueta="Nombre (opcional)"
          ayuda="Para distinguirla en la lista de arriba, si usas varias máquinas."
          value={nombre}
          onChange={setNombre}
          placeholder="la del periódico"
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
