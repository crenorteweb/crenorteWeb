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
  uf?: string;
  bairro?: string;
  status?: string;
  assessorId?: string;
  assessorNome?: string;
  analistaId?: string;
  analistaNome?: string;
  supervisorId?: string;
  supervisorNome?: string;
  origem?: string;
  resultado?: 'apto' | 'inapto';
  motivoInapto?: string;
  contatoRealizado?: boolean;
  observacaoAssessor?: string;
  agendamento?: any;
  formalizado?: boolean;
  criadoEm?: any;
  encaminhadoEm?: any;
  analisadoEm?: any;
  elegivel?: { status: 'nao_verificado' | 'sim' | 'nao' };
  encaminhadoPorUid?: string;
  encaminhadoPorNome?: string;
  encaminhadoParaUid?: string;
  encaminhadoParaNome?: string;
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
  criadoEm?: any;
}

export type CargoFiltro = 'assessor' | 'analista' | 'supervisor' | 'geral';
export type ResultadoFiltro = 'todos' | 'apto' | 'inapto' | 'nao_analisado';

export interface PeriodoFiltro {
  inicio: string;
  fim: string;
}
