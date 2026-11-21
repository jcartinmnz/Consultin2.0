/**
 * Contratos de las fuentes de datos.
 * El agente y las rutas SOLO dependen de estas interfaces. Para conectar un dato real
 * se agrega una implementación nueva y se cambia la variable en wrangler.toml.
 */

export interface ProductoCotizado {
  sku: string;
  nombre: string;
  familia: string | null;   // Shamir | Image | Convencional | Terminado | Servicios
  diseno: string | null;
  tipo: string;
  material: string | null;
  indice: number | null;
  tratamiento: string | null;
  color: string | null;
  precio: number;
  moneda: string;
  unidad: string;           // "par" casi siempre
  rango: string | null;     // "Esf -4.00 a +4.00 / Cil hasta -2.00"
  notas: string | null;     // altura de pupila mínima, protección, adicionales…
  consultar?: boolean;      // la lista lo marca "CONSULTAR"
  aviso?: string;
}

export interface BusquedaPrecio {
  /** Texto libre tal como lo escribió la óptica */
  consulta: string;
  tipo?: string;
  /** Marca o familia: Shamir, Image, Younger, Futurex… */
  marca?: string;
  material?: string;
  indice?: number;
  tratamiento?: string;
  color?: string;
  esfera?: number;
  cilindro?: number;
}

export interface PriceSource {
  readonly nombre: string;
  buscar(q: BusquedaPrecio, limite?: number): Promise<ProductoCotizado[]>;
}

export interface EstadoOrden {
  numeroOrden: string;
  /** Código de cliente en LensWare: se usa para validar que la orden es de quien pregunta */
  codigoCliente: string;
  /** Código crudo de LensWare (ej. "SURF") */
  estadoCodigo: string;
  /** Traducción humana (ej. "En tallado") */
  estado: string;
  estacion: string | null;
  fechaIngreso: string | null;   // ISO
  fechaEstimada: string | null;  // ISO
  referencia: string | null;     // referencia de la óptica, NUNCA nombre de paciente
}

export interface OrderSource {
  readonly nombre: string;
  obtener(numeroOrden: string): Promise<EstadoOrden | null>;
  /** Últimas órdenes de un cliente (para "¿cómo van mis órdenes?") */
  recientes(codigoCliente: string, limite?: number): Promise<EstadoOrden[]>;
}
