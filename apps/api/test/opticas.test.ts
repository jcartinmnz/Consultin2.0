import { describe, expect, it } from "vitest";
import { parseCsv } from "../scripts/import-precios";
import { aOpticas, notasPerfil } from "../scripts/import-opticas";

const ENC = "clave,nombre,razon_social,codigo_sap,codigo_mac,ruta,whatsapp,telefonos,correo,horario,ubicacion,contacto,notas";

describe("importador de ópticas", () => {
  it("lee números, valida correo y arma notas del perfil", () => {
    const [o] = aOpticas(parseCsv(`${ENC}\nK1,Óptica X,"X, S.A.",30,51,Cartago,50688880000|50677770000,50622220000,TODO POR WHATSAPP,L a V 9-5,Centro,Ana,`));
    expect(o).toMatchObject({ clave: "K1", razonSocial: "X, S.A.", whatsapp: ["50688880000", "50677770000"], telefonos: ["50622220000"], correo: null });
    expect(notasPerfil(o!)).toBe("Ruta: Cartago\nHorario: L a V 9-5\nContacto: Ana\nCódigo SAP: 30 · MAC: 51");
  });

  it("rechaza números mal formados y claves repetidas con el número de línea", () => {
    expect(() => aOpticas(parseCsv(`${ENC}\nK1,X,,,,,8888,,,,,,`))).toThrow(/Línea 2.*inválido/);
    expect(() => aOpticas(parseCsv(`${ENC}\nK1,X,,,,,,,,,,,\nK1,Y,,,,,,,,,,,`))).toThrow(/repetida/);
  });
});
