import { describe, expect, it } from "vitest";
import { normalizarTelefono } from "../src/lib/telefono";
import { nuevoCliente } from "../src/routes/clientes";

describe("normalizarTelefono", () => {
  it.each([
    ["8821-2216", "50688212216"], ["+506 8821 2216", "50688212216"], ["50688212216", "50688212216"],
    ["+1 202 908 7457", "12029087457"], ["8477550", null], ["abc", null], ["0000 0001", null], ["50610000000", null], ["2222-3333", "50622223333"],
  ])("%s → %s", (e, s) => expect(normalizarTelefono(e)).toBe(s));
});

describe("formulario de alta", () => {
  it("óptica: vacíos pasan a null y los números son opcionales", () => {
    const o = nuevoCliente.parse({ tipo: "optica", nombre: "  Óptica Nueva ", codigoLensware: "", whatsapp: ["8888-0000"] });
    expect(o).toMatchObject({ tipo: "optica", nombre: "Óptica Nueva", codigoLensware: null, whatsapp: ["8888-0000"] });
  });
  it("persona: valida el correo y exige nombre", () => {
    expect(() => nuevoCliente.parse({ tipo: "persona", nombre: "Ana", email: "no-es-correo" })).toThrow(/Correo inválido/);
    expect(() => nuevoCliente.parse({ tipo: "persona", nombre: "" })).toThrow(/Falta el nombre/);
  });
  it("rechaza tipos desconocidos", () => {
    expect(() => nuevoCliente.parse({ tipo: "otro", nombre: "X" })).toThrow();
  });
});
