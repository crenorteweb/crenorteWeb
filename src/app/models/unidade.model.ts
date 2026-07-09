export type StatusUnidade = 'ativa' | 'inativa';

export interface Unidade {
  id?: string;
  nome: string;
  descricao?: string | null;
  status: StatusUnidade;
  criadoEm: number;
  atualizadoEm?: number;
}
