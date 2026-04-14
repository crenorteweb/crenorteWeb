import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, finalize } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { HeaderComponent } from '../shared/header/header.component';
import { ProducaoService } from '../../services/producao.service';
import { CargoFiltro, Colaborador, PreCadastro, ResultadoFiltro } from '../../models/producao.model';

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
  data        = signal('');

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

  /** Registros filtrados por origem/analista/município/bairro (sem busca CPF) — alimenta os cards de resumo */
  registrosPorOrigem = computed(() => {
    let lista = this.registrosOriginais();

    const origem = this.filtroOrigem().trim();
    if (origem) lista = lista.filter(r => (r.origem || '').trim() === origem);

    const analista = this.filtroAnalista().trim();
    if (analista) lista = lista.filter(r => r.analistaId === analista);

    const municipio = this.filtroMunicipio().trim();
    if (municipio) lista = lista.filter(r => (r.municipio || '').trim() === municipio);

    const bairro = this.filtroBairro().trim();
    if (bairro) lista = lista.filter(r => (r.bairro || '').trim() === bairro);

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
    const set = new Set<string>();
    this.registrosOriginais().forEach(r => {
      const m = (r.municipio || '').trim();
      if (m) set.add(m);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  bairrosDisponiveis = computed(() => {
    const municipio = this.filtroMunicipio().trim();
    const base = municipio
      ? this.registrosOriginais().filter(r => (r.municipio || '').trim() === municipio)
      : this.registrosOriginais();
    const set = new Set<string>();
    base.forEach(r => {
      const b = (r.bairro || '').trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

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

  // ── Handlers de filtro ────────────────────────────────────────────────────

  onCargo(cargo: CargoFiltro) {
    this.cargo.set(cargo);
    this.colaborador.set(null);
    this.registrosOriginais.set([]);
    this.termoBusca.set('');
    this.filtroResultado.set('todos');
    this.filtroOrigem.set('');
    this.filtroAnalista.set('');
    this.filtroMunicipio.set('');
    this.filtroBairro.set('');
    this.jaCarregou.set(false);
    this.erro.set(null);
    if (cargo === 'geral' && this.data()) this.buscar();
  }

  onColaborador(colab: Colaborador) {
    this.colaborador.set(colab);
    this.buscar();
  }

  onData(data: string) {
    this.data.set(data);
    if (this.colaborador() || this.cargo() === 'geral') this.buscar();
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
    const cargo = this.cargo();
    const colab = this.colaborador();
    const data  = this.data();
    if (!cargo || !data) return;
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
      cargo === 'assessor'  ? this.svc.buscarPorAssessor(uid, data)  :
      cargo === 'analista'  ? this.svc.buscarPorAnalista(uid, data)  :
      cargo === 'geral'     ? this.svc.buscarTodosAnalisados(data)   :
                              this.svc.buscarPorSupervisor(uid, data);

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

  contarResultado(fr: ResultadoFiltro): number {
    return this.registrosPorOrigem().filter(r =>
      fr === 'nao_analisado' ? !r.resultado : r.resultado === fr
    ).length;
  }

  get mostrarFiltroNaoAnalisado(): boolean {
    return this.cargo() === 'assessor' || this.cargo() === 'supervisor';
  }
}
