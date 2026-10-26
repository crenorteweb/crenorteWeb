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
  abaAtiva                  = signal<'analisados' | 'adicionados' | 'novas_tentativas' | 'encaminhados' | 'caixa_assessores'>('analisados');
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
    this.termoBusca.set('');
    this.filtroResultado.set('todos');
    this.filtroOrigem.set('');
    this.filtroAnalista.set('');
    this.filtroMunicipio.set('');
    this.filtroBairro.set('');
    this.filtroTentativas.set(false);
    this.filtroOrigemAdicionados.set('');
    this.abaAtiva.set('analisados');
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
