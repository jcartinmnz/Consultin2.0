import { describe, expect, it } from "vitest";
import { ranking, type ProductoRow } from "../src/sources/prices/scoring";
import { aProductos, parseCsv } from "../scripts/import-precios";

/** Productos inventados con la misma forma que la lista real (el repo es público: sin precios reales). */
const p = (o: Partial<ProductoRow> & Pick<ProductoRow, "sku" | "nombre" | "tipo" | "precio">): ProductoRow => ({
  material: null, indice: null, tratamiento: null, esferaMin: null, esferaMax: null, cilindroMax: null,
  moneda: "CRC", alias: null, unidad: "par", ...o,
});
const LISTA: ProductoRow[] = [
  p({ sku: "A1", nombre: "Shamir Autograph III CR39", familia: "Shamir", diseno: "Shamir Autograph III", tipo: "progresivo", material: "CR39", indice: 1.5, tratamiento: "Claro", precio: 100, alias: "shamir cr39 cr-39 1.50 claro multifocal" }),
  p({ sku: "A2", nombre: "Shamir Autograph III 1.67 Transitions Gen 8", familia: "Shamir", diseno: "Shamir Autograph III", tipo: "progresivo", material: "1.67", indice: 1.67, tratamiento: "Transitions Gen 8", color: "Gray/Brown", precio: 300, alias: "shamir 1.67 alto indice transitions gen8 fotocromatico multifocal" }),
  p({ sku: "A3", nombre: "Progresivo Image Mobile 1.67 Transitions Gen S", familia: "Image", diseno: "Progresivo Image Mobile", tipo: "progresivo", material: "1.67", indice: 1.67, tratamiento: "Transitions Gen S", precio: 200, notas: "Altura de pupila mínima 17 mm.", alias: "image 1.67 transitions gens fotocromatico multifocal" }),
  p({ sku: "A4", nombre: "Shamir Intelligence CR39 Photo", familia: "Shamir", tipo: "progresivo", material: "CR39", indice: 1.5, tratamiento: "Photo", precio: 150, consultar: true, alias: "shamir cr39 photo fotocromatico" }),
  p({ sku: "B1", nombre: "Monofocal CR39 Younger Optics Nupolar Polarizado", familia: "Convencional", tipo: "monofocal", material: "CR39", indice: 1.5, tratamiento: "Nupolar Polarizado", precio: 50, alias: "talla convencional younger cr39 nupolar polarizado sol vision sencilla" }),
  p({ sku: "T1", nombre: "Monofocal terminado Policarbonato Nexus-ILT antireflejo verde", familia: "Terminado", tipo: "monofocal", material: "Policarbonato", indice: 1.59, tratamiento: "Antireflejo verde", esferaMin: -4, esferaMax: 4, cilindroMax: -2, precio: 40, alias: "terminado poly policarbonato antireflejo antirreflejo ar vision sencilla" }),
  p({ sku: "S1", nombre: "Montaje al aire", familia: "Servicios", tipo: "servicio", precio: 10, alias: "servicio laboratorio montaje perforado al aire" }),
];

describe("buscar en la lista de precios", () => {
  it("entiende 'multifocal', índice y 'transiciones'; a igual relevancia, el más barato primero", () => {
    const r = ranking(LISTA, { consulta: "multifocal 1.67 con transiciones", indice: 1.67 });
    expect(r.map((x) => x.sku)).toEqual(["A3", "A2"]);
  });

  it("filtra por marca", () => {
    const r = ranking(LISTA, { consulta: "progresivo 1.67 transitions", marca: "shamir" });
    expect(r.map((x) => x.sku)).toEqual(["A2"]);
  });

  it("'CR-39' y 'polarizados' encuentran CR39 polarizado", () => {
    expect(ranking(LISTA, { consulta: "visión sencilla CR-39 polarizados" })[0]!.sku).toBe("B1");
  });

  it("respeta el rango de graduación de los terminados", () => {
    expect(ranking(LISTA, { consulta: "terminado poly antirreflejo", esfera: -3 }).map((x) => x.sku)).toContain("T1");
    expect(ranking(LISTA, { consulta: "terminado poly antirreflejo", esfera: -6 }).map((x) => x.sku)).not.toContain("T1");
  });

  it("busca servicios de laboratorio", () => {
    const [r] = ranking(LISTA, { consulta: "cuánto sale el montaje al aire", tipo: "servicio" });
    expect(r).toMatchObject({ sku: "S1", precio: 10, unidad: "par" });
  });

  it("los precios 'CONSULTAR' llevan aviso", () => {
    const r = ranking(LISTA, { consulta: "shamir photo cr39" }).find((x) => x.sku === "A4");
    expect(r?.consultar).toBe(true);
    expect(r?.aviso).toMatch(/confirmar/i);
  });

  it("devuelve notas (p. ej. altura de pupila mínima)", () => {
    expect(ranking(LISTA, { consulta: "image mobile" })[0]!.notas).toContain("17 mm");
  });

  it("sin coincidencias devuelve vacío", () => {
    expect(ranking(LISTA, { consulta: "lente de contacto tórico" })).toEqual([]);
  });
});

describe("importador de CSV", () => {
  const csv = [
    "sku,familia,nombre,tipo,material,indice,precio,consultar,notas,esfera_min",
    'X1,Shamir,"Shamir InTouch CR39",progresivo,CR39,1.5,25000,no,"Nota con, coma",',
    "X2,Servicios,Montaje corriente,Servicio,,,1200,si,,",
  ].join("\n");

  it("lee comillas y comas, normaliza tipo y consultar", () => {
    const [a, b] = aProductos(parseCsv(csv));
    expect(a).toMatchObject({ sku: "X1", nombre: "Shamir InTouch CR39", indice: "1.5", precio: "25000", consultar: false, notas: "Nota con, coma", esferaMin: null });
    expect(b).toMatchObject({ sku: "X2", tipo: "servicio", material: null, consultar: true });
  });

  it("rechaza precios inválidos y SKUs repetidos con el número de línea", () => {
    expect(() => aProductos(parseCsv("sku,nombre,tipo,precio\nX,Y,monofocal,abc"))).toThrow(/Línea 2/);
    expect(() => aProductos(parseCsv("sku,nombre,tipo,precio\nX,Y,monofocal,1\nX,Z,monofocal,2"))).toThrow(/repetido/);
  });
});
