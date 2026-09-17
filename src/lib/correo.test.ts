import { describe, expect, it } from "vitest";
import { completar, dominioDe } from "./correo";

const SITIO = "lasillavacia.com";
const c = (v: string) => completar(v, SITIO);

describe("dominioDe", () => {
  it("se queda con el anfitrión y tira el resto", () => {
    expect(dominioDe("https://lasillavacia.com")).toBe("lasillavacia.com");
    expect(dominioDe("https://www.lasillavacia.com/")).toBe("lasillavacia.com");
    expect(dominioDe("https://lasillavacia.com/redaccion?x=1")).toBe("lasillavacia.com");
    expect(dominioDe("LaSillaVacia.com")).toBe("lasillavacia.com");
    expect(dominioDe("  tumedio.co  ")).toBe("tumedio.co");
    expect(dominioDe("http://localhost:8765")).toBe("localhost");
    expect(dominioDe("")).toBe("");
  });
});

describe("completar el correo tras el arroba", () => {
  it("no ofrece nada mientras no haya arroba", () => {
    expect(c("")).toBe("");
    expect(c("imontes")).toBe("");
  });

  it("recién puesto el arroba ofrece el dominio del sitio entero", () => {
    expect(c("imontes@")).toBe("lasillavacia.com");
  });

  it("el dominio del sitio va primero y sigue mientras encaje", () => {
    expect(c("imontes@la")).toBe("sillavacia.com");
    expect(c("imontes@lasillavacia.c")).toBe("om");
  });

  it("si lo escrito ya no encaja con el sitio, pasa al proveedor que sí", () => {
    // El caso que trae esto: el correo del WordPress puede ser uno personal.
    expect(c("imontes@g")).toBe("mail.com");
    expect(c("imontes@hot")).toBe("mail.com");
    expect(c("imontes@yah")).toBe("oo.com");
  });

  it("si no encaja con ninguno, no estorba", () => {
    expect(c("imontes@zzz")).toBe("");
  });

  it("nada que ofrecer sobre un correo ya completo", () => {
    expect(c("imontes@lasillavacia.com")).toBe("");
    expect(c("imontes@gmail.com")).toBe("");
  });

  it("las mayúsculas no lo despistan", () => {
    expect(c("Imontes@LaSilla")).toBe("vacia.com");
  });

  it("no ofrece nada sin nombre delante, ni con dos arrobas", () => {
    expect(c("@la")).toBe("");
    expect(c("imontes@la@")).toBe("");
  });

  it("sin dominio del sitio se queda con los proveedores comunes", () => {
    expect(completar("imontes@", "")).toBe("gmail.com");
    expect(completar("imontes@la", "")).toBe("");
  });
});
