import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, finalize } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { HeaderComponent } from '../shared/header/header.component';
import { ProducaoService } from '../../services/producao.service';
import { normalizarTexto, isCidadePrioritaria, isBairroPrioritario, ordenarComPrioridade } from '../../core/constants/regioes-prioritarias.constant';
import { CargoFiltro, Colaborador, PeriodoFiltro, PreCadastro, ResultadoFiltro } from '../../models/producao.model';

import { FiltroCargo } from '../../components/producao/filtro-cargo/filtro-cargo.component';
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
    FiltroCargo,
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

  // ── Filtros ───────────────────────────────────────────────────────────────
  cargo       = signal<CargoFiltro | null>(null);
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
  clienteSelecionado = signal<PreCadastro | null>(null);
  carregando         = signal(false);
  jaCarregou         = signal(false);
  erro               = signal<string | null>(null);

  // ── Relatório de cadastros adicionados (modo geral) ───────────────────────
  abaAtiva                  = signal<'analisados' | 'adicionados' | 'encaminhados'>('analisados');
  registrosAdicionados      = signal<PreCadastro[]>([]);
  filtroOrigemAdicionados   = signal<string>('');
  carregandoAdicionados     = signal(false);
  jaCarregouAdicionados     = signal(false);
  erroAdicionados           = signal<string | null>(null);

  // ── Relatório de encaminhamentos (modo geral) ─────────────────────────────
  registrosEncaminhados     = signal<PreCadastro[]>([]);
  carregandoEncaminhados    = signal(false);
  jaCarregouEncaminhados    = signal(false);
  erroEncaminhados          = signal<string | null>(null);

  /** Registros filtrados por origem/analista/município/bairro (sem busca CPF) — alimenta os cards de resumo */
  registrosPorOrigem = computed(() => {
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

  // ── Handlers de filtro ────────────────────────────────────────────────────

  onCargo(cargo: CargoFiltro) {
    this.cargo.set(cargo);
    this.colaborador.set(null);
    this.registrosOriginais.set([]);
    this.registrosAdicionados.set([]);
    this.termoBusca.set('');
    this.filtroResultado.set('todos');
    this.filtroOrigem.set('');
    this.filtroAnalista.set('');
    this.filtroMunicipio.set('');
    this.filtroBairro.set('');
    this.filtroOrigemAdicionados.set('');
    this.abaAtiva.set('analisados');
    this.jaCarregou.set(false);
    this.jaCarregouAdicionados.set(false);
    this.jaCarregouEncaminhados.set(false);
    this.erro.set(null);
    this.erroAdicionados.set(null);
    this.erroEncaminhados.set(null);
    if (cargo === 'geral' && this.dataInicio()) {
      this.buscar();
      this.buscarAdicionados();
      this.buscarEncaminhados();
    }
  }

  onColaborador(colab: Colaborador) {
    this.colaborador.set(colab);
    this.buscar();
  }

  onData(periodo: PeriodoFiltro) {
    this.dataInicio.set(periodo.inicio);
    this.dataFim.set(periodo.fim);
    if (this.colaborador() || this.cargo() === 'geral') this.buscar();
    if (this.cargo() === 'geral') {
      this.buscarAdicionados();
      this.buscarEncaminhados();
    }
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
    return this.cargo() === 'assessor' || this.cargo() === 'supervisor';
  }
}
