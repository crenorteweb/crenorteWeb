import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, finalize } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import { HeaderComponent } from '../shared/header/header.component';
import { ProducaoService } from '../../services/producao.service';
import { normalizarTexto, isCidadePrioritaria, isBairroPrioritario, ordenarComPrioridade } from '../../core/constants/regioes-prioritarias.constant';
import { CargoFiltro, Colaborador, PeriodoFiltro, PreCadastro, ResultadoFiltro } from '../../models/producao.model';

import { FiltroColaborador } from '../../components/producao/filtro-colaborador/filtro-colaborador.component';
import { FiltroData } from '../../components/producao/filtro-data/filtro-data.component';
import { BuscaCpf } from '../../components/producao/busca-cpf/busca-cpf.component';
import { TabelaProducao } from '../../components/producao/tabela-producao/tabela-producao.component';
import { CardsResumo } from '../../components/producao/cards-resumo/cards-resumo.component';
import { BotoesExportacao } from '../../components/producao/botoes-exportacao/botoes-exportacao.component';
import { ModalDetalheCliente } from '../../components/producao/modal-detalhe-cliente/modal-detalhe-cliente.component';

@Component({
  selector: 'app-producao',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HeaderComponent,
    FiltroColaborador,
    FiltroData,
    BuscaCpf,
    TabelaProducao,
    CardsResumo,
    BotoesExportacao,
    ModalDetalheCliente,
  ],
  templateUrl: './producao.component.html',
  styleUrls: ['./producao.component.css'],
})
export class ProducaoComponent {
  private svc = inject(ProducaoService);

  @ViewChild(FiltroData) private filtroData!: FiltroData;

  // ── Filtros ───────────────────────────────────────────────────────────────
  cargo       = signal<CargoFiltro | null>('geral');
  colaborador = signal<Colaborador | null>(null);
  dataInicio  = signal('');
  dataFim     = signal('');

  // ── Dados ─────────────────────────────────────────────────────────────────
  registrosOriginais = signal<PreCadastro[]>([]);
  termoBusca         = signal('');
  filtroResultado    = signal<ResultadoFiltro>('todos');
  filtroOrigem       = signal<string>('');
  filtroAnalista     = signal<string>('');
  filtroMunicipio    = signal<string>('');
  filtroBairro       = signal<string>('');
  filtroTentativas   = signal(false);
  clienteSelecionado = signal<PreCadastro | null>(null);
  carregando         = signal(false);
  jaCarregou         = signal(false);
  erro               = signal<string | null>(null);

  // ── Relatório de cadastros adicionados (modo geral) ───────────────────────
  abaAtiva                  = signal<'visao_geral' | 'falta_analisar' | 'analisados' | 'adicionados' | 'novas_tentativas' | 'encaminhados' | 'caixa_assessores'>('visao_geral');
  registrosAdicionados      = signal<PreCadastro[]>([]);
  filtroOrigemAdicionados   = signal<string>('');
  carregandoAdicionados     = signal(false);
  jaCarregouAdicionados     = signal(false);
  erroAdicionados           = signal<string | null>(null);

  // ── Tentativas de recadastro pelo site (clientes já cadastrados) ──────────
  registrosTentativas       = signal<PreCadastro[]>([]);
  carregandoTentativas      = signal(false);
  mostrarListaTentativas    = signal(false);

  // ── Aba "Novas tentativas": já analisados antes do período que tentaram de novo ──
  filtroRetornoResultado    = signal<'todos' | 'apto' | 'inapto' | 'nao_analisado'>('todos');
  filtroRetornoMunicipio    = signal<string>('');
  termoBuscaRetorno         = signal<string>('');

  // ── Relatório de encaminhamentos (modo geral) ─────────────────────────────
  registrosEncaminhados     = signal<PreCadastro[]>([]);
  carregandoEncaminhados    = signal(false);
  jaCarregouEncaminhados    = signal(false);
  erroEncaminhados          = signal<string | null>(null);

  // ── Caixa dos assessores (snapshot atual, sem filtro de data) ─────────────
  registrosCaixaAssessores  = signal<PreCadastro[]>([]);
  carregandoCaixaAssessores = signal(false);
  jaCarregouCaixaAssessores = signal(false);
  erroCaixaAssessores       = signal<string | null>(null);

  /** Filtros de origem/analista/município/bairro (sem tentativas e sem busca CPF) */
  private registrosBaseFiltros = computed(() => {
    let lista = this.registrosOriginais();

    const origem = this.filtroOrigem().trim();
    if (origem) lista = lista.filter(r => (r.origem || '').trim() === origem);

    const analista = this.filtroAnalista().trim();
    if (analista) lista = lista.filter(r => r.analistaId === analista);

    const municipio = normalizarTexto(this.filtroMunicipio().trim());
    if (municipio) lista = lista.filter(r => normalizarTexto((r.municipio || '').trim()) === municipio);

    const bairro = normalizarTexto(this.filtroBairro().trim());
    if (bairro) lista = lista.filter(r => normalizarTexto((r.bairro || '').trim()) === bairro);

    return lista;
  });

  /** Quantidade de clientes com novas tentativas de cadastro (respeita os demais filtros) */
  contarComTentativas = computed(() =>
    this.registrosBaseFiltros().filter(r => (r.totalTentativas ?? 0) > 0).length
  );

  /** Registros filtrados por origem/analista/município/bairro/tentativas (sem busca CPF) — alimenta os cards de resumo */
  registrosPorOrigem = computed(() => {
    const lista = this.registrosBaseFiltros();
    return this.filtroTentativas()
      ? lista.filter(r => (r.totalTentativas ?? 0) > 0)
      : lista;
  });

  origensDisponiveis = computed(() => {
    const set = new Set<string>();
    this.registrosOriginais().forEach(r => {
      const o = (r.origem || '').trim();
      if (o) set.add(o);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  municipiosDisponiveis = computed(() => {
    const map = new Map<string, string>(); // normalizado → valor original
    this.registrosOriginais().forEach(r => {
      const m = (r.municipio || '').trim();
      if (!m) return;
      const key = normalizarTexto(m);
      if (!map.has(key)) map.set(key, m);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  municipiosOrdenados = computed(() =>
    ordenarComPrioridade(this.municipiosDisponiveis(), isCidadePrioritaria)
  );

  bairrosDisponiveis = computed(() => {
    const municipio = normalizarTexto(this.filtroMunicipio().trim());
    const base = municipio
      ? this.registrosOriginais().filter(r => normalizarTexto((r.municipio || '').trim()) === municipio)
      : this.registrosOriginais();
    const map = new Map<string, string>(); // normalizado → valor original
    base.forEach(r => {
      const b = (r.bairro || '').trim();
      if (!b) return;
      const key = normalizarTexto(b);
      if (!map.has(key)) map.set(key, b);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  bairrosOrdenados = computed(() =>
    ordenarComPrioridade(this.bairrosDisponiveis(), isBairroPrioritario)
  );

  analistasDisponiveis = computed(() => {
    if (this.cargo() !== 'geral') return [];
    const map = new Map<string, string>();
    this.registrosOriginais().forEach(r => {
      if (r.analistaId && r.analistaNome) map.set(r.analistaId, r.analistaNome);
    });
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  });

  /** Nome do analista selecionado no filtro (modo geral) — vazio quando "Todos" */
  filtroAnalistaNome = computed(() => {
    const uid = this.filtroAnalista().trim();
    if (!uid) return '';
    return this.analistasDisponiveis().find(a => a.id === uid)?.nome || '';
  });

  registrosFiltrados = computed(() => {
    let lista = this.registrosPorOrigem();

    const fr = this.filtroResultado();
    if (fr !== 'todos') {
      lista = lista.filter(r =>
        fr === 'nao_analisado' ? !r.resultado : r.resultado === fr
      );
    }

    const digits = this.termoBusca().replace(/\D/g, '');
    if (digits) {
      lista = lista.filter(r => (r.cpf || '').replace(/\D/g, '').includes(digits));
    }

    return lista;
  });

  origensAdicionadas = computed(() => {
    const set = new Set<string>();
    this.registrosAdicionados().forEach(r => {
      const o = (r.origem || '').trim();
      if (o) set.add(o);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  registrosAdicionadosFiltrados = computed(() => {
    const origem = this.filtroOrigemAdicionados().trim();
    return origem
      ? this.registrosAdicionados().filter(r => (r.origem || '').trim() === origem)
      : this.registrosAdicionados();
  });

  adicionadosPorOrigem = computed(() => {
    const map = new Map<string, number>();
    this.registrosAdicionadosFiltrados().forEach(r => {
      const o = (r.origem || '').trim() || 'Sem origem';
      map.set(o, (map.get(o) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  });

  adicionadosPorAssessor = computed(() => {
    const map = new Map<string, number>();
    this.registrosAdicionadosFiltrados().forEach(r => {
      const nome = (r.assessorNome || '').trim() || 'Desconhecido';
      map.set(nome, (map.get(nome) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  });

  /** Tentativas aparecem junto da origem Site / portal (ou sem filtro de origem) */
  exibirTentativas = computed(() => {
    const o = this.filtroOrigemAdicionados().trim();
    return !o || o === 'Site / portal';
  });

  /** Total de tentativas (eventos) no período — um cliente pode tentar mais de uma vez */
  totalTentativasNoPeriodo = computed(() =>
    this.registrosTentativas().reduce((acc, r) => acc + (r.tentativasNoPeriodo ?? 0), 0)
  );

  /** Data/hora de início do período selecionado (ms) */
  private inicioPeriodoMs(): number {
    const ini = this.dataInicio();
    if (!ini) return 0;
    const [y, m, d] = ini.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }

  private tsMs(ts: any): number {
    if (!ts) return 0;
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    } catch { return 0; }
  }

  /**
   * Clientes que tentaram se cadastrar novamente no período e NÃO foram analisados
   * no período: os analisados antes do início do período + os ainda não analisados.
   */
  retornosAposAnalise = computed(() => {
    const inicio = this.inicioPeriodoMs();
    return this.registrosTentativas().filter(r => {
      if (r.resultado !== 'apto' && r.resultado !== 'inapto') return true; // não analisado
      const analise = this.tsMs(r.analisadoEm);
      return !analise || analise < inicio;
    });
  });

  retornosMunicipios = computed(() => {
    const map = new Map<string, string>();
    this.retornosAposAnalise().forEach(r => {
      const m = (r.municipio || '').trim();
      if (m && !map.has(normalizarTexto(m))) map.set(normalizarTexto(m), m);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  /** Base com filtro de município (alimenta contadores) */
  private retornosBase = computed(() => {
    const mun = normalizarTexto(this.filtroRetornoMunicipio().trim());
    const lista = this.retornosAposAnalise();
    return mun ? lista.filter(r => normalizarTexto((r.municipio || '').trim()) === mun) : lista;
  });

  retornosFiltrados = computed(() => {
    let lista = this.retornosBase();
    const fr = this.filtroRetornoResultado();
    if (fr === 'nao_analisado') lista = lista.filter(r => !r.resultado);
    else if (fr !== 'todos') lista = lista.filter(r => r.resultado === fr);
    const digits = this.termoBuscaRetorno().replace(/\D/g, '');
    if (digits) lista = lista.filter(r => (r.cpf || '').replace(/\D/g, '').includes(digits));
    return lista;
  });

  contarRetorno(fr: 'todos' | 'apto' | 'inapto' | 'nao_analisado'): number {
    const base = this.retornosBase();
    if (fr === 'todos') return base.length;
    if (fr === 'nao_analisado') return base.filter(r => !r.resultado).length;
    return base.filter(r => r.resultado === fr).length;
  }

  contarRetornoElegiveis = computed(() =>
    this.retornosBase().filter(r => r.elegivel?.status === 'sim').length
  );

  elegivelLabel(r: PreCadastro): string {
    const s = r.elegivel?.status;
    if (s === 'sim')            return 'Elegível';
    if (s === 'nao')            return 'Não elegível';
    if (s === 'nao_verificado') return 'Não verificado';
    return '—';
  }

  private fmtData(ts: any, comHora = false): string {
    const ms = this.tsMs(ts);
    if (!ms) return '—';
    const d = new Date(ms);
    return comHora
      ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('pt-BR');
  }

  private linhasRetorno(): { cab: string[]; linhas: string[][] } {
    const cab = ['Nome do Cliente', 'CPF', 'Telefone', 'Município', 'Bairro', 'Origem',
                 'Cadastrado em', 'Resultado anterior', 'Analisado em', 'Analista',
                 'Elegibilidade', 'Última tentativa'];
    const linhas = this.retornosFiltrados().map(r => [
      r.clienteNome || '—', r.cpf || '—', r.telefone || '—', r.municipio || '—', r.bairro || '—',
      r.origem || '—', this.fmtData(r.criadoEm),
      r.resultado === 'apto' ? 'Apto' : r.resultado === 'inapto' ? 'Inapto' : 'Não analisado',
      this.fmtData(r.analisadoEm), r.analistaNome || '—', this.elegivelLabel(r),
      this.fmtData(r.ultimaTentativaEm, true),
    ]);
    return { cab, linhas };
  }

  private nomeArquivoRetorno(ext: string): string {
    const p = this.dataInicio() === this.dataFim() ? this.dataInicio() : `${this.dataInicio()}_a_${this.dataFim()}`;
    return `novas_tentativas_${p}.${ext}`;
  }

  exportarExcelRetornos() {
    const { cab, linhas } = this.linhasRetorno();
    if (!linhas.length) return;
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    ws['!cols'] = [32, 16, 16, 20, 20, 18, 14, 16, 14, 24, 16, 18].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Novas tentativas');
    XLSX.writeFile(wb, this.nomeArquivoRetorno('xlsx'));
  }

  exportarPDFRetornos() {
    const { cab, linhas } = this.linhasRetorno();
    if (!linhas.length) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(18); doc.setTextColor(0, 141, 69); doc.text('CRENORTE', 14, 18);
    doc.setFontSize(12); doc.setTextColor(40, 40, 40);
    const fr = this.filtroRetornoResultado();
    const frLabel = { todos: '', apto: 'Eram aptos', inapto: 'Eram inaptos', nao_analisado: 'Não analisados' }[fr];
    doc.text(`Novas tentativas — clientes não analisados no período${frLabel ? ' · ' + frLabel : ''}`, 14, 27);
    doc.setFontSize(10); doc.setTextColor(80, 80, 80);
    const fmt = (s: string) => s.split('-').reverse().join('/');
    const periodo = this.dataInicio() === this.dataFim() ? fmt(this.dataInicio()) : `${fmt(this.dataInicio())} a ${fmt(this.dataFim())}`;
    doc.text(`Período das tentativas: ${periodo}`, 14, 35);
    doc.text(`Total de clientes: ${linhas.length}`, 14, 41);
    autoTable(doc, {
      head: [cab], body: linhas, startY: 47,
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      margin: { left: 10, right: 10 },
    });
    const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 10, finalY + 8);
    doc.save(this.nomeArquivoRetorno('pdf'));
  }

  // ── Aba "Visão geral": todos os clientes do período (novos + novas tentativas) ──
  filtroGeralResultado = signal<'todos' | 'apto' | 'apto_elegivel' | 'inapto' | 'nao_analisado'>('todos');
  filtroGeralTipo      = signal<'todos' | 'novo' | 'tentativa'>('todos');
  filtroGeralMunicipio = signal<string>('');
  filtroGeralUf        = signal<string>('');
  filtroGeralOrigem    = signal<string>('');
  termoBuscaGeral      = signal<string>('');

  /**
   * Todos os clientes do período, sem duplicar:
   *  - novo:      cadastro criado dentro do período (aba Adicionados);
   *  - tentativa: cliente que já existia e tentou se cadastrar de novo no período.
   * Quem foi criado no período e também tentou de novo conta como "novo".
   */
  visaoGeral = computed<(PreCadastro & { tipoEntrada: 'novo' | 'tentativa' })[]>(() => {
    const tentPorId = new Map(this.registrosTentativas().map(t => [t.id, t]));
    const vistos = new Set<string>();
    const lista: (PreCadastro & { tipoEntrada: 'novo' | 'tentativa' })[] = [];
    this.registrosAdicionados().forEach(r => {
      if (vistos.has(r.id)) return;
      vistos.add(r.id);
      lista.push({ ...(tentPorId.get(r.id) ?? r), tipoEntrada: 'novo' });
    });
    this.registrosTentativas().forEach(r => {
      if (vistos.has(r.id)) return;
      vistos.add(r.id);
      lista.push({ ...r, tipoEntrada: 'tentativa' });
    });
    return lista;
  });

  private ufDe(r: PreCadastro): string {
    return (r.uf || '').trim().toUpperCase();
  }

  geralUfs = computed(() => {
    const set = new Set<string>();
    this.visaoGeral().forEach(r => { const uf = this.ufDe(r); if (uf) set.add(uf); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  /** Clientes da UF selecionada (ou todos) */
  private geralPorUf = computed(() => {
    const uf = this.filtroGeralUf();
    const lista = this.visaoGeral();
    return uf ? lista.filter(r => this.ufDe(r) === uf) : lista;
  });

  geralOrigens = computed(() => {
    const map = new Map<string, number>();
    this.visaoGeral().forEach(r => {
      const o = (r.origem || '').trim() || 'Sem origem';
      map.set(o, (map.get(o) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([origem, total]) => ({ origem, total }))
      .sort((a, b) => b.total - a.total);
  });

  onFiltroGeralUf(uf: string) {
    this.filtroGeralUf.set(uf);
    this.filtroGeralMunicipio.set('');
  }

  geralMunicipios = computed(() => {
    const map = new Map<string, string>();
    this.geralPorUf().forEach(r => {
      const m = (r.municipio || '').trim();
      if (m && !map.has(normalizarTexto(m))) map.set(normalizarTexto(m), m);
    });
    return ordenarComPrioridade(Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR')), isCidadePrioritaria);
  });

  /** Base só com filtros de origem, UF e município (alimenta os contadores de tipo) */
  private geralPorMunicipio = computed(() => {
    const mun = normalizarTexto(this.filtroGeralMunicipio().trim());
    const origem = this.filtroGeralOrigem();
    let lista = this.geralPorUf();
    if (origem) lista = lista.filter(r => ((r.origem || '').trim() || 'Sem origem') === origem);
    return mun ? lista.filter(r => normalizarTexto((r.municipio || '').trim()) === mun) : lista;
  });

  /** Base com filtros de município e tipo (alimenta os contadores de resultado) */
  private geralBase = computed(() => {
    const tipo = this.filtroGeralTipo();
    const lista = this.geralPorMunicipio();
    return tipo === 'todos' ? lista : lista.filter(r => r.tipoEntrada === tipo);
  });

  private passaFiltroGeral(r: PreCadastro, fr: 'todos' | 'apto' | 'apto_elegivel' | 'inapto' | 'nao_analisado'): boolean {
    if (fr === 'todos')         return true;
    if (fr === 'nao_analisado') return r.resultado !== 'apto' && r.resultado !== 'inapto';
    if (fr === 'apto_elegivel') return r.resultado === 'apto' && r.elegivel?.status === 'sim';
    if (fr === 'apto')          return r.resultado === 'apto' && r.elegivel?.status !== 'sim'; // aptos não elegíveis
    return r.resultado === fr;
  }

  contarGeral(fr: 'todos' | 'apto' | 'apto_elegivel' | 'inapto' | 'nao_analisado'): number {
    return this.geralBase().filter(r => this.passaFiltroGeral(r, fr)).length;
  }

  contarGeralTipo(tipo: 'todos' | 'novo' | 'tentativa'): number {
    const base = this.geralPorMunicipio();
    return tipo === 'todos' ? base.length : base.filter(r => r.tipoEntrada === tipo).length;
  }

  geralFiltrados = computed(() => {
    const fr = this.filtroGeralResultado();
    let lista = this.geralBase().filter(r => this.passaFiltroGeral(r, fr));
    const digits = this.termoBuscaGeral().replace(/\D/g, '');
    if (digits) lista = lista.filter(r => (r.cpf || '').replace(/\D/g, '').includes(digits));
    return lista;
  });

  /** Soma das tentativas feitas no período (eventos — um cliente pode tentar várias vezes) */
  totalTentativasGeral = computed(() =>
    this.geralBase().reduce((acc, r) => acc + (r.tentativasNoPeriodo ?? 0), 0)
  );

  situacaoLabel(r: PreCadastro): string {
    return r.resultado === 'apto' ? 'Apto' : r.resultado === 'inapto' ? 'Inapto' : 'Falta analisar';
  }

  private linhasGeral(): { cab: string[]; linhas: string[][] } {
    const cab = ['Nome do Cliente', 'CPF', 'Telefone', 'Município', 'Bairro', 'Origem', 'Entrada',
                 'Cadastrado em', 'Situação', 'Analisado em', 'Analista', 'Elegibilidade',
                 'Tentativas no período', 'Tentativas (total)', 'Última tentativa'];
    const linhas = this.geralFiltrados().map(r => [
      r.clienteNome || '—', r.cpf || '—', r.telefone || '—', r.municipio || '—', r.bairro || '—',
      r.origem || '—', r.tipoEntrada === 'novo' ? 'Novo cadastro' : 'Nova tentativa',
      this.fmtData(r.criadoEm), this.situacaoLabel(r), this.fmtData(r.analisadoEm),
      r.analistaNome || '—', this.elegivelLabel(r),
      String(r.tentativasNoPeriodo ?? 0), String(r.totalTentativas ?? 0),
      this.fmtData(r.ultimaTentativaEm, true),
    ]);
    return { cab, linhas };
  }

  private nomeArquivoGeral(ext: string): string {
    const p = this.dataInicio() === this.dataFim() ? this.dataInicio() : `${this.dataInicio()}_a_${this.dataFim()}`;
    return `visao_geral_${p}.${ext}`;
  }

  exportarExcelGeral() {
    const { cab, linhas } = this.linhasGeral();
    if (!linhas.length) return;
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    ws['!cols'] = [32, 16, 16, 20, 20, 18, 16, 14, 14, 14, 24, 16, 12, 12, 18].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Visão geral');
    XLSX.writeFile(wb, this.nomeArquivoGeral('xlsx'));
  }

  exportarPDFGeral() {
    const { cab, linhas } = this.linhasGeral();
    if (!linhas.length) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(18); doc.setTextColor(0, 141, 69); doc.text('CRENORTE', 14, 18);
    doc.setFontSize(12); doc.setTextColor(40, 40, 40);
    doc.text('Visão geral — novos cadastros e novas tentativas do período', 14, 27);
    doc.setFontSize(10); doc.setTextColor(80, 80, 80);
    const fmt = (s: string) => s.split('-').reverse().join('/');
    const periodo = this.dataInicio() === this.dataFim() ? fmt(this.dataInicio()) : `${fmt(this.dataInicio())} a ${fmt(this.dataFim())}`;
    doc.text(`Período: ${periodo}`, 14, 35);
    doc.text(
      `Total: ${this.contarGeral('todos')}  ·  Aptos não elegíveis: ${this.contarGeral('apto')}  ·  Aptos e elegíveis: ${this.contarGeral('apto_elegivel')}` +
      `  ·  Inaptos: ${this.contarGeral('inapto')}  ·  Falta analisar: ${this.contarGeral('nao_analisado')}` +
      `  ·  Tentativas no período: ${this.totalTentativasGeral()}` +
      `  ·  Listados: ${linhas.length}`, 14, 41);
    autoTable(doc, {
      head: [cab], body: linhas, startY: 47,
      styles: { fontSize: 7, cellPadding: 1.8 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      margin: { left: 8, right: 8 },
    });
    const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 8, finalY + 8);
    doc.save(this.nomeArquivoGeral('pdf'));
  }

  // ── Aba "Falta analisar": CPFs do período ainda sem análise ─────────────────
  filtroPendUf        = signal<string>('');
  filtroPendMunicipio = signal<string>('');
  filtroPendOrigem    = signal<string>('');
  termoBuscaPend      = signal<string>('');
  ordemPend           = signal<'antigos' | 'recentes'>('antigos');

  /** Clientes do período (novos + novas tentativas) que ainda não foram analisados */
  pendentes = computed(() =>
    this.visaoGeral().filter(r => r.resultado !== 'apto' && r.resultado !== 'inapto')
  );

  pendUfs = computed(() => {
    const set = new Set<string>();
    this.pendentes().forEach(r => { const uf = this.ufDe(r); if (uf) set.add(uf); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  private pendPorUf = computed(() => {
    const uf = this.filtroPendUf();
    return uf ? this.pendentes().filter(r => this.ufDe(r) === uf) : this.pendentes();
  });

  pendMunicipios = computed(() => {
    const map = new Map<string, string>();
    this.pendPorUf().forEach(r => {
      const m = (r.municipio || '').trim();
      if (m && !map.has(normalizarTexto(m))) map.set(normalizarTexto(m), m);
    });
    return ordenarComPrioridade(Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR')), isCidadePrioritaria);
  });

  pendOrigens = computed(() => {
    const map = new Map<string, number>();
    this.pendentes().forEach(r => {
      const o = (r.origem || '').trim() || 'Sem origem';
      map.set(o, (map.get(o) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([origem, total]) => ({ origem, total }))
      .sort((a, b) => b.total - a.total);
  });

  onFiltroPendUf(uf: string) {
    this.filtroPendUf.set(uf);
    this.filtroPendMunicipio.set('');
  }

  /** Data de referência: para nova tentativa, a última tentativa; para novo cadastro, a criação */
  private refPendMs(r: PreCadastro & { tipoEntrada: 'novo' | 'tentativa' }): number {
    return r.tipoEntrada === 'tentativa'
      ? (this.tsMs(r.ultimaTentativaEm) || this.tsMs(r.criadoEm))
      : this.tsMs(r.criadoEm);
  }

  pendFiltrados = computed(() => {
    let lista = this.pendPorUf();
    const origem = this.filtroPendOrigem();
    if (origem) lista = lista.filter(r => ((r.origem || '').trim() || 'Sem origem') === origem);
    const mun = normalizarTexto(this.filtroPendMunicipio().trim());
    if (mun) lista = lista.filter(r => normalizarTexto((r.municipio || '').trim()) === mun);
    const digits = this.termoBuscaPend().replace(/\D/g, '');
    if (digits) lista = lista.filter(r => (r.cpf || '').replace(/\D/g, '').includes(digits));
    const dir = this.ordemPend() === 'antigos' ? 1 : -1;
    return [...lista].sort((a, b) => dir * (this.refPendMs(a) - this.refPendMs(b)));
  });

  contarPendTipo(tipo: 'novo' | 'tentativa'): number {
    return this.pendFiltrados().filter(r => r.tipoEntrada === tipo).length;
  }

  dataHora(ts: any): string {
    return this.fmtData(ts, true);
  }

  /** Há quanto tempo o cliente está aguardando análise (desde a criação ou a última tentativa) */
  aguardandoHa(r: PreCadastro & { tipoEntrada: 'novo' | 'tentativa' }): string {
    const ms = this.refPendMs(r);
    if (!ms) return '—';
    const horas = Math.floor((Date.now() - ms) / 3_600_000);
    if (horas < 1)  return 'menos de 1 h';
    if (horas < 24) return `${horas} h`;
    const dias = Math.floor(horas / 24);
    return dias === 1 ? '1 dia' : `${dias} dias`;
  }

  private linhasPend(): { cab: string[]; linhas: string[][] } {
    const cab = ['CPF', 'Nome do Cliente', 'Telefone', 'Município', 'UF', 'Origem', 'Entrada',
                 'Cadastro criado em', 'Última tentativa', 'Tentativas no período', 'Aguardando há'];
    const linhas = this.pendFiltrados().map(r => [
      r.cpf || '—', r.clienteNome || '—', r.telefone || '—', r.municipio || '—', r.uf || '—',
      r.origem || '—', r.tipoEntrada === 'novo' ? 'Novo cadastro' : 'Nova tentativa',
      this.fmtData(r.criadoEm, true), this.fmtData(r.ultimaTentativaEm, true),
      String(r.tentativasNoPeriodo ?? 0), this.aguardandoHa(r),
    ]);
    return { cab, linhas };
  }

  private nomeArquivoPend(ext: string): string {
    const p = this.dataInicio() === this.dataFim() ? this.dataInicio() : `${this.dataInicio()}_a_${this.dataFim()}`;
    return `falta_analisar_${p}.${ext}`;
  }

  exportarExcelPend() {
    const { cab, linhas } = this.linhasPend();
    if (!linhas.length) return;
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    ws['!cols'] = [16, 32, 16, 20, 6, 18, 16, 18, 18, 12, 14].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Falta analisar');
    XLSX.writeFile(wb, this.nomeArquivoPend('xlsx'));
  }

  exportarPDFPend() {
    const { cab, linhas } = this.linhasPend();
    if (!linhas.length) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(18); doc.setTextColor(0, 141, 69); doc.text('CRENORTE', 14, 18);
    doc.setFontSize(12); doc.setTextColor(40, 40, 40);
    doc.text('Falta analisar — CPFs do período ainda sem análise', 14, 27);
    doc.setFontSize(10); doc.setTextColor(80, 80, 80);
    const fmt = (s: string) => s.split('-').reverse().join('/');
    const periodo = this.dataInicio() === this.dataFim() ? fmt(this.dataInicio()) : `${fmt(this.dataInicio())} a ${fmt(this.dataFim())}`;
    doc.text(`Período: ${periodo}`, 14, 35);
    doc.text(`Total: ${linhas.length}  ·  Novos cadastros: ${this.contarPendTipo('novo')}  ·  Novas tentativas: ${this.contarPendTipo('tentativa')}`, 14, 41);
    autoTable(doc, {
      head: [cab], body: linhas, startY: 47,
      styles: { fontSize: 7.5, cellPadding: 1.8 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      margin: { left: 8, right: 8 },
    });
    const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 8, finalY + 8);
    doc.save(this.nomeArquivoPend('pdf'));
  }

  encaminhadosPorRemetente = computed(() => {
    const map = new Map<string, { uid: string; nome: string; count: number }>();
    this.registrosEncaminhados().forEach(r => {
      const uid  = r.encaminhadoPorUid  || '';
      const nome = (r.encaminhadoPorNome || '').trim() || 'Desconhecido';
      const key  = uid || nome;
      const cur  = map.get(key) ?? { uid, nome, count: 0 };
      map.set(key, { uid, nome, count: cur.count + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  });

  encaminhadosPorAssessor = computed(() => {
    const map = new Map<string, { uid: string; nome: string; count: number }>();
    this.registrosEncaminhados().forEach(r => {
      const uid  = r.encaminhadoParaUid  || '';
      const nome = (r.encaminhadoParaNome || '').trim() || 'Desconhecido';
      const key  = uid || nome;
      const cur  = map.get(key) ?? { uid, nome, count: 0 };
      map.set(key, { uid, nome, count: cur.count + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  });

  assessorSelecionadoCaixa = signal<string>('');

  caixaAssessoresPorAssessor = computed(() => {
    const map = new Map<string, {
      key: string; nome: string; total: number; aptos: number; elegiveis: number; inaptos: number; semResultado: number;
    }>();
    this.registrosCaixaAssessores().forEach(r => {
      const uid  = r.encaminhadoParaUid || r.assessorId || '';
      const nome = (r.encaminhadoParaNome || r.assessorNome || 'Desconhecido').trim();
      const key  = uid || nome;
      const cur  = map.get(key) ?? { key, nome, total: 0, aptos: 0, elegiveis: 0, inaptos: 0, semResultado: 0 };
      cur.total++;
      if (r.resultado === 'apto')       cur.aptos++;
      if (r.resultado === 'inapto')     cur.inaptos++;
      if (r.elegivel?.status === 'sim') cur.elegiveis++;
      if (!r.resultado)                 cur.semResultado++;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  });

  caixaTotais = computed(() =>
    this.caixaAssessoresPorAssessor().reduce(
      (acc, item) => ({
        aptos:        acc.aptos        + item.aptos,
        elegiveis:    acc.elegiveis    + item.elegiveis,
        inaptos:      acc.inaptos      + item.inaptos,
        semResultado: acc.semResultado + item.semResultado,
      }),
      { aptos: 0, elegiveis: 0, inaptos: 0, semResultado: 0 }
    )
  );

  clientesCaixaAssessorSelecionado = computed(() => {
    const key = this.assessorSelecionadoCaixa();
    if (!key) return [];
    return this.registrosCaixaAssessores().filter(r => {
      const uid  = r.encaminhadoParaUid || r.assessorId || '';
      const nome = (r.encaminhadoParaNome || r.assessorNome || 'Desconhecido').trim();
      return (uid || nome) === key;
    });
  });

  nomeAssessorSelecionadoCaixa = computed(() =>
    this.caixaAssessoresPorAssessor().find(a => a.key === this.assessorSelecionadoCaixa())?.nome || ''
  );

  // ── Handlers de filtro ────────────────────────────────────────────────────

  onCargo(cargo: CargoFiltro) {
    this.cargo.set(cargo);
    this.colaborador.set(null);
    this.registrosOriginais.set([]);
    this.registrosAdicionados.set([]);
    this.registrosTentativas.set([]);
    this.mostrarListaTentativas.set(false);
    this.filtroRetornoResultado.set('todos');
    this.filtroRetornoMunicipio.set('');
    this.termoBuscaRetorno.set('');
    this.filtroGeralResultado.set('todos');
    this.filtroGeralTipo.set('todos');
    this.filtroGeralMunicipio.set('');
    this.filtroGeralUf.set('');
    this.filtroGeralOrigem.set('');
    this.termoBuscaGeral.set('');
    this.filtroPendUf.set('');
    this.filtroPendMunicipio.set('');
    this.filtroPendOrigem.set('');
    this.termoBuscaPend.set('');
    this.termoBusca.set('');
    this.filtroResultado.set('todos');
    this.filtroOrigem.set('');
    this.filtroAnalista.set('');
    this.filtroMunicipio.set('');
    this.filtroBairro.set('');
    this.filtroTentativas.set(false);
    this.filtroOrigemAdicionados.set('');
    this.abaAtiva.set('visao_geral');
    this.jaCarregou.set(false);
    this.jaCarregouAdicionados.set(false);
    this.jaCarregouEncaminhados.set(false);
    this.jaCarregouCaixaAssessores.set(false);
    this.registrosCaixaAssessores.set([]);
    this.assessorSelecionadoCaixa.set('');
    this.erro.set(null);
    this.erroAdicionados.set(null);
    this.erroEncaminhados.set(null);
    this.erroCaixaAssessores.set(null);
  }

  onColaborador(colab: Colaborador) {
    this.colaborador.set(colab);
    this.buscar();
  }

  onData(periodo: PeriodoFiltro) {
    this.dataInicio.set(periodo.inicio);
    this.dataFim.set(periodo.fim);
  }

  irParaHoje() {
    this.filtroData.resetar();
  }

  buscarTudo() {
    if (!this.dataInicio()) return;
    this.buscar();
    this.buscarAdicionados();
    this.buscarEncaminhados();
    if (!this.jaCarregouCaixaAssessores()) this.carregarCaixaAssessores();
  }

  onTermoBusca(termo: string) {
    this.termoBusca.set(termo);
  }

  onFiltroMunicipio(municipio: string) {
    this.filtroMunicipio.set(municipio);
    this.filtroBairro.set('');
  }

  // ── Busca principal ───────────────────────────────────────────────────────

  private buscar() {
    const cargo      = this.cargo();
    const colab      = this.colaborador();
    const dataInicio = this.dataInicio();
    const dataFim    = this.dataFim();
    if (!cargo || !dataInicio) return;
    if (cargo !== 'geral' && !colab) return;

    const uid = colab?.uid || colab?.id || '';

    this.carregando.set(true);
    this.erro.set(null);
    this.registrosOriginais.set([]);
    this.filtroResultado.set('todos');
    this.filtroOrigem.set('');
    this.filtroAnalista.set('');
    this.filtroMunicipio.set('');
    this.filtroBairro.set('');
    this.filtroTentativas.set(false);
    this.termoBusca.set('');

    const obs$ =
      cargo === 'assessor'  ? this.svc.buscarPorAssessor(uid, dataInicio, dataFim)  :
      cargo === 'analista'  ? this.svc.buscarPorAnalista(uid, dataInicio, dataFim)  :
      cargo === 'geral'     ? this.svc.buscarTodosAnalisados(dataInicio, dataFim)   :
                              this.svc.buscarPorSupervisor(uid, dataInicio, dataFim);

    obs$.pipe(
      catchError(e => {
        this.erro.set('Erro ao buscar dados: ' + (e?.message || 'Tente novamente.'));
        return EMPTY;
      }),
      finalize(() => {
        this.carregando.set(false);
        this.jaCarregou.set(true);
      }),
    ).subscribe(registros => {
      this.registrosOriginais.set(registros);
    });
  }

  private buscarAdicionados() {
    const dataInicio = this.dataInicio();
    const dataFim    = this.dataFim();
    if (!dataInicio) return;

    this.carregandoAdicionados.set(true);
    this.erroAdicionados.set(null);
    this.registrosAdicionados.set([]);
    this.filtroOrigemAdicionados.set('');
    this.filtroGeralResultado.set('todos');
    this.filtroGeralTipo.set('todos');
    this.filtroGeralMunicipio.set('');
    this.filtroGeralUf.set('');
    this.filtroGeralOrigem.set('');
    this.termoBuscaGeral.set('');
    this.filtroPendUf.set('');
    this.filtroPendMunicipio.set('');
    this.filtroPendOrigem.set('');
    this.termoBuscaPend.set('');

    this.svc.buscarAdicionados(dataInicio, dataFim).pipe(
      catchError(e => {
        this.erroAdicionados.set('Erro ao buscar cadastros adicionados: ' + (e?.message || 'Tente novamente.'));
        return EMPTY;
      }),
      finalize(() => {
        this.carregandoAdicionados.set(false);
        this.jaCarregouAdicionados.set(true);
      }),
    ).subscribe(registros => {
      this.registrosAdicionados.set(registros);
    });

    this.buscarTentativas(dataInicio, dataFim);
  }

  private buscarTentativas(dataInicio: string, dataFim: string) {
    this.carregandoTentativas.set(true);
    this.registrosTentativas.set([]);
    this.mostrarListaTentativas.set(false);
    this.filtroRetornoResultado.set('todos');
    this.filtroRetornoMunicipio.set('');
    this.termoBuscaRetorno.set('');

    this.svc.buscarTentativasRecadastro(dataInicio, dataFim).pipe(
      catchError(e => {
        console.error('[producao] erro ao buscar tentativas de recadastro', e);
        return EMPTY;
      }),
      finalize(() => this.carregandoTentativas.set(false)),
    ).subscribe(registros => {
      this.registrosTentativas.set(registros);
    });
  }

  private buscarEncaminhados() {
    const dataInicio = this.dataInicio();
    const dataFim    = this.dataFim();
    if (!dataInicio) return;

    this.carregandoEncaminhados.set(true);
    this.erroEncaminhados.set(null);
    this.registrosEncaminhados.set([]);

    this.svc.buscarEncaminhados(dataInicio, dataFim).pipe(
      catchError(e => {
        this.erroEncaminhados.set('Erro ao buscar encaminhamentos: ' + (e?.message || 'Tente novamente.'));
        return EMPTY;
      }),
      finalize(() => {
        this.carregandoEncaminhados.set(false);
        this.jaCarregouEncaminhados.set(true);
      }),
    ).subscribe(registros => {
      this.registrosEncaminhados.set(registros);
    });
  }

  private carregarCaixaAssessores() {
    this.carregandoCaixaAssessores.set(true);
    this.erroCaixaAssessores.set(null);
    this.registrosCaixaAssessores.set([]);

    this.svc.buscarCaixaAssessores().pipe(
      catchError(e => {
        this.erroCaixaAssessores.set('Erro ao buscar caixa dos assessores: ' + (e?.message || 'Tente novamente.'));
        return EMPTY;
      }),
      finalize(() => {
        this.carregandoCaixaAssessores.set(false);
        this.jaCarregouCaixaAssessores.set(true);
      }),
    ).subscribe(registros => {
      this.registrosCaixaAssessores.set(registros);
    });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  abrirModal(preCadastro: PreCadastro) {
    this.clienteSelecionado.set(preCadastro);
  }

  fecharModal() {
    this.clienteSelecionado.set(null);
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  get nomeColaborador(): string {
    if (this.cargo() === 'geral') return 'Todos os Analistas';
    return this.colaborador()?.nome || '';
  }

  get periodoLabel(): string {
    const ini = this.dataInicio();
    const fim = this.dataFim();
    if (!ini) return '';
    return ini === fim ? ini : `${ini} a ${fim}`;
  }

  contarResultado(fr: ResultadoFiltro): number {
    return this.registrosPorOrigem().filter(r =>
      fr === 'nao_analisado' ? !r.resultado : r.resultado === fr
    ).length;
  }

  get mostrarFiltroNaoAnalisado(): boolean {
    return this.cargo() === 'assessor' || this.cargo() === 'supervisor' || this.cargo() === 'geral';
  }
}
