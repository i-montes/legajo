/* Completar el correo después del arroba.
   Quien conecta un archivo escribe su correo de ese WordPress, y casi siempre
   es del propio dominio que acaba de teclear dos campos más arriba: pedírselo
   otra vez, letra por letra, es pedir un dato que la pantalla ya tiene. Pero
   no siempre —hay redacciones cuyo WordPress va con el Gmail de cada quien—,
   así que el dominio del sitio es la primera opción y no la única. */

/** Los de siempre, para cuando el correo del WordPress no es el del medio. */
const COMUNES = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com"];

/** El anfitrión de una dirección, que es lo único que sirve como dominio de
 *  correo: sin esquema, sin `www.`, sin puerto y sin la ruta detrás. Se escribe
 *  a mano y no con `new URL()` porque aquí llega lo que la persona va tecleando
 *  —«tumedio.co» a medias— y eso no es una URL válida hasta el final. */
export function dominioDe(origen: string): string {
  const s = origen.trim().toLowerCase();
  if (!s) return "";
  const sinEsquema = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const anfitrion = (sinEsquema.split(/[/?#]/)[0] ?? "").split("@").pop() ?? "";
  return anfitrion.replace(/:\d+$/, "").replace(/^www\./, "");
}

/** Lo que falta por escribir, o cadena vacía si no hay nada que ofrecer.
 *  Devuelve el resto y no el correo entero para que quien lo pinte sepa qué
 *  parte va en gris sin tener que restar cadenas. */
export function completar(valor: string, dominioSitio: string): string {
  const partes = valor.split("@");
  // Ni antes del arroba, ni con el arroba solo, ni con dos: en los tres casos
  // no hay un dominio a medias que completar.
  if (partes.length !== 2) return "";
  const [nombre, escrito] = partes;
  if (!nombre.trim()) return "";

  const yaEscrito = escrito.toLowerCase();
  const candidatos = [dominioDe(dominioSitio), ...COMUNES].filter(Boolean);
  for (const d of candidatos) {
    if (d.startsWith(yaEscrito) && d !== yaEscrito) return d.slice(yaEscrito.length);
  }
  return "";
}
