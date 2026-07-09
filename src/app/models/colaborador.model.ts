export type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';

export type StatusColaborador = 'ativo' | 'inativo';

export interface Colaborador {
  uid: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;

  rota: string;
  unidadeId?: string | null;
  status: StatusColaborador;

  // Hierarquia (para assessor)
  supervisorId?: string | null;
  analistaId?: string | null;

  // Extras
  cpf?: string | null;
  telefone?: string | null;     // <== NOVO (somente dígitos)
  photoURL?: string | null;

  criadoEm: number;
  id?: string; // conveniência

  // Permissão especial: permite que este analista encaminhe pré-cadastros para outro analista
  podeEncaminharParaAnalista?: boolean;
}
