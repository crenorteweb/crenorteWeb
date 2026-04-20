/**
 * Regiões prioritárias da Crenorte.
 * Usadas para ordenar filtros de UF, cidade e bairro nos componentes existentes.
 */

export const UFS_PRIORITARIAS: string[] = [
  'PA', 'RO', 'RR', 'AM', 'TO', 'AP', 'AC'
];

export const CIDADES_PRIORITARIAS: string[] = [
  // Unidade Parauapebas / Carajás
  'Parauapebas', 'Eldorado dos Carajás', 'Curionópolis', 'Canaã dos Carajás',
  'Piçarra', 'Água Azul do Norte', 'Palmares I', 'Palmares II', 'Serra Pelada',

  // Unidade Marabá
  'Marabá', 'Bom Jesus do Tocantins', 'Brejo Grande do Araguaia', 'Itupiranga',
  'São Domingos do Araguaia', 'São João do Araguaia', 'Eldorado',

  // Unidade Tucuruí
  'Tucuruí', 'Jacundá', 'Breu Branco', 'Novo Repartimento', 'Nova Ipixuna',

  // Unidade Bragança
  'Bragança', 'Capanema', 'Salinas', 'São João de Pirabas', 'Santarém Novo',
  'Peixe Boi', 'Nova Timboteua', 'Bonito', 'Santa Luzia do Pará', 'Viseu',
  'Augusto Corrêa', 'Tracuateua', 'Primavera', 'Quatipuru',

  // Unidade Paragominas
  'Paragominas', 'Irituia', 'Dom Eliseu', 'Capitão Poço', 'Garrafão do Norte',
  'Ourém', 'São Miguel do Guamá', 'Mãe do Rio', 'Aurora', 'Ipixuna', 'Ulianópolis',

  // Unidade Castanhal
  'Castanhal', 'Terra Alta', 'Vigia', 'São Caetano de Odivelas', 'Colares',
  'Santo Antônio do Tauá', 'Curuçá', 'São João da Ponta', 'Marapanim',
  'Igarapé-Açu', 'São Francisco do Pará', 'Inhangapi', 'Santa Izabel do Pará',
  'Santa Maria do Pará', 'São Domingos do Capim', 'Maracanã', 'Magalhães Barata',

  // Unidade Marajó
  'Breves', 'Portel', 'Ponta de Pedras', 'Cachoeira do Arari',

  // Região Metropolitana de Belém
  'Belém', 'Ananindeua', 'Marituba', 'Benevides', 'Santa Izabel',
];

export const BAIRROS_PRIORITARIOS: string[] = [
  // Bairros de Belém
  'Cidade Velha', 'Campina', 'Reduto', 'Umarizal', 'Telégrafo', 'Sacramenta',
  'Pedreira', 'Marco', 'Souza', 'Marambaia', 'Canudos', 'Fátima', 'São Brás',
  'Nazaré', 'Batista Campos', 'Jurunas', 'Condor', 'Guamá', 'Terra Firme',
  'Cremação', 'Val-de-Cães', 'Miramar', 'Pratinha', 'Tapanã', 'Benguí',
  'Maracangalha', 'Barreiro', 'Universitário', 'Curió-Utinga', 'Aurá',
  'Castanheira', 'Águas Lindas', 'Guanabara', 'São Clemente', 'Parque Guajará',
  'Tenoné', 'Águas Negras', 'Maracacuera', 'Parque Verde', 'Cruzeiro',
  'Ponta Grossa', 'Mangueirão', 'Cabanagem', 'Campina de Icoaraci', 'Paracuri',
  'Agulha', 'Una', 'Coqueiro', 'São João do Outeiro', 'Itaiteua', 'Água Negra',
  'Maracajá', 'Vila', 'Praia Grande', 'Farol', 'Mangueiras', 'São Francisco',
  'Carananduba', 'Marahu', 'Paraíso', 'Baía do Sol', 'Sucurijuquara', 'Caruara',
  'Bonfim', 'Ariramba', 'Porto Arthur', 'Murubira', 'Chapéu Virado', 'Aeroporto',

  // Bairros de Ananindeua
  '40 Horas', 'Águas Brancas', 'Águas Lindas', 'Atalaia', 'Aurá', 'Centro',
  'Cidade Nova', 'Coqueiro', 'Curuçambá', 'Distrito Industrial', 'Dom Bosco',
  'Guanabara', 'Heliolândia', 'Icuí-Guajará', 'Icuí-Laranjeira', 'Jaderlândia',
  'Jiboia Branca', 'Júlia Sefer', 'Maguari', 'PAAR', 'Providência',
];

/**
 * Normaliza uma string para comparação: remove acentos e converte para minúsculas.
 * Exemplos: "Belém" → "belem" | "BELEM" → "belem" | "belém" → "belem"
 */
export function normalizarTexto(texto: string): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Verifica se uma cidade está na lista prioritária (case-insensitive + sem acento). */
export function isCidadePrioritaria(cidade: string): boolean {
  const norm = normalizarTexto(cidade);
  return CIDADES_PRIORITARIAS.some(c => normalizarTexto(c) === norm);
}

/** Verifica se uma UF está na lista prioritária. */
export function isUfPrioritaria(uf: string): boolean {
  return UFS_PRIORITARIAS.includes(uf?.toUpperCase());
}

/** Verifica se um bairro está na lista prioritária (case-insensitive + sem acento). */
export function isBairroPrioritario(bairro: string): boolean {
  const norm = normalizarTexto(bairro);
  return BAIRROS_PRIORITARIOS.some(b => normalizarTexto(b) === norm);
}

/**
 * Recebe uma lista de strings e retorna com os itens prioritários no topo,
 * seguidos dos demais em ordem alfabética.
 */
export function ordenarComPrioridade(
  lista: string[],
  isPrioritario: (item: string) => boolean
): { valor: string; prioritario: boolean }[] {
  const prioritarios = lista.filter(isPrioritario);
  const demais = lista
    .filter(item => !isPrioritario(item))
    .sort((a, b) => normalizarTexto(a).localeCompare(normalizarTexto(b)));

  return [
    ...prioritarios.map(v => ({ valor: v, prioritario: true })),
    ...demais.map(v => ({ valor: v, prioritario: false })),
  ];
}
