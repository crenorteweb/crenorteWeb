// src/app/models/cliente.model.ts

/** Categorias de anexos aceitas no formulário + 'assinatura' */
export type AnexoCategoria =
  | 'docPessoa'
  | 'fotoPessoa'
  | 'selfieDocumento'
  | 'fotoEmpreendimento'
  | 'fotoProdutos'
  | 'fotoEquipamentos'
  | 'orcamento'
  | 'planoNegocio'
  | 'assinatura';

/** Mapa de URLs por categoria (cada categoria pode ter várias imagens) */
export type AnexosMap = Partial<Record<AnexoCategoria, string[]>>;

/** Itens "outros" dentro de custos variáveis do fluxo de caixa */
export interface FluxoCaixaOutro {
  nome: string;
  valor: number; // número já normalizado
}

/** Custos fixos do fluxo de caixa */
export interface FluxoCaixaFixos {
  aluguel: number;
  salarios: number;
  energiaEletrica: number;
  agua: number;
  telefoneInternet: number;
}

/** Custos variáveis do fluxo de caixa */
export interface FluxoCaixaVariaveis {
  materiaPrima: number;
  insumos: number;
  frete: number;
  transporte: number;
  outros: FluxoCaixaOutro[];
}

/** Estrutura principal do fluxo de caixa */
export interface FluxoCaixa {
  faturamentoMensal: number;     // receita bruta mensal (número)
  fixos: FluxoCaixaFixos;
  variaveis: FluxoCaixaVariaveis;
}

/** Totais calculados para exibição/validação */
export interface FluxoCaixaTotais {
  receita: number;
  custos: number;
  lucro: number;
}

/** Model principal do cliente */
export interface Cliente {
  // Identificação e perfil
  nomeCompleto: string;
  cpf: string;                       // salvo limpo (somente dígitos)
  rg: string;
  genero: string;
  estadoCivil: string;
  escolaridade: string;
  corRaca: string;
  religiao: string;

  // Nacionalidade
  nacionalidade: string;             // "Brasileiro Nato" | "Brasileiro Naturalizado" | país | "Prefere não declarar"
  paisOrigem: string;                // preenchido quando nacionalidade = país estrangeiro
  dataNascimento: string;            // ISO "YYYY-MM-DD"

  // Contato / Endereço
  contato: string;                   // máscara no form; persistência pode ficar como string formatada
  email: string;
  endereco: string;
  tipoResidencia: string;
  cep: string;
  bairro: string;
  cidade: string;
  estado: string;

  // Empreendimento
  jaEmpreende: boolean;
  tipoNegocio: string;
  ondeVende: string;
  faturamentoMensal: string;         // valor mascarado no formulário (exibição)
  tempoEmpreendimento: string;
  ocupacaoAtual: string;

  // Renda pessoal
  outraRenda: boolean;
  rendaMensal: string;               // valor mascarado no formulário

  // Financiamento
  valorSolicitado: string;           // mascarado no formulário
  parcelas?: number | null; // <— adiciona null
  valorParcela: string;              // mascarado no formulário
  usoValor: string;

  // Situação Crenorte
  clienteCrenorte: boolean;
  emprestimoAtivo: boolean;
  instituicaoEmprestimo: string;

  // Datas / Consentimento
  dataPreenchimento: string;         // ISO "YYYY-MM-DD"
  autorizacaoUsoDados: boolean;

  // Fluxo de Caixa
  fluxoCaixa: FluxoCaixa | null;
  fluxoCaixaTotais: FluxoCaixaTotais;

  // Anexos (preenchido após upload)
  anexos?: AnexosMap;

  // Metadados opcionais
  criadoEm?: Date | string;          // definido no TS ao salvar

  status?: StatusCadastro;                // novo
  statusHistory?: StatusEvent[];          // novo
}

export type StatusCadastro = 'em_analise' | 'aprovado' | 'reprovado';

export interface StatusEvent {
  at: Date;                 // quando mudou
  byUid: string;            // quem mudou
  byNome?: string;
  from?: StatusCadastro;
  to: StatusCadastro;
  note?: string;            // observação quando reprovado ou ajuste
}

