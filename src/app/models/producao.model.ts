// Modelos específicos do módulo de Produção.
// Campos opcionais com Partial para tolerar variações no Firestore.

export interface Colaborador {
  id: string;
  uid?: string;
  nome: string;
  cargo: 'assessor' | 'analista' | 'supervisor' | 'admin';
  email?: string;
}

export interface PreCadastro {
  id: string;
  clienteNome?: string;
  cpf?: string;
  telefone?: string;
  municipio?: string;
  status?: string;
  assessorId?: string;
  assessorNome?: string;
  analistaId?: string;
  analistaNome?: string;
  supervisorId?: string;
  supervisorNome?: string;
  resultado?: 'apto' | 'inapto';
  motivoInapto?: string;
  contatoRealizado?: boolean;
  observacaoAssessor?: string;
  agendamento?: any;
  formalizado?: boolean;
  criadoEm?: any;
  encaminhadoEm?: any;
  analisadoEm?: any;
}

export interface Cliente {
  id: string;
  nome?: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  municipio?: string;
  estado?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  dataNascimento?: string;
  sexo?: string;
  status?: string;
}

export type CargoFiltro = 'assessor' | 'analista' | 'supervisor' | 'geral';
export type ResultadoFiltro = 'todos' | 'apto' | 'inapto' | 'nao_analisado';
