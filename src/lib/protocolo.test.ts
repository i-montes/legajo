import { describe, expect, it } from "vitest";
import { desenvolverOk } from "./protocolo";

describe("desenvolverOk", () => {
  it("desenvuelve {ok: v} y devuelve v", () => {
    expect(desenvolverOk({ ok: { a: 1 } })).toEqual({ ok: true, valor: { a: 1 } });
  });

  it("desenvuelve {ok: v} incluso cuando v es null o false", () => {
    expect(desenvolverOk({ ok: null })).toEqual({ ok: true, valor: null });
    expect(desenvolverOk({ ok: false })).toEqual({ ok: true, valor: false });
  });

  it("distingue {error: m}", () => {
    expect(desenvolverOk({ error: "algo salió mal" })).toEqual({ ok: false, error: "algo salió mal" });
  });

  it("no reconoce nada sin `ok` ni `error`", () => {
    expect(desenvolverOk({ version: "1.0" })).toEqual({ ok: false });
    expect(desenvolverOk(null)).toEqual({ ok: false });
    expect(desenvolverOk("texto")).toEqual({ ok: false });
  });
});
