/**
 * Tipagem oficial de retorno para todas as AI Tools do Rastreio.IO.
 * Nenhuma ferramenta deve retornar objetos vazios quando a informação não existir.
 */
export interface ToolResult<T = any> {
  found: boolean;
  data: T | null;
  reason: string;
}
