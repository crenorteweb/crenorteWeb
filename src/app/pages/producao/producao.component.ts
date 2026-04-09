import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, finalize } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { HeaderComponent } from '../shared/header/header.component';
import { ProducaoService } from '../../services/producao.service';
import { CargoFiltro, Colaborador, PreCadastro } from '../../models/producao.model';

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
  registrosFiltrados = signal<PreCadastro[]>([]);
  clienteSelecionado = signal<PreCadastro | null>(null);
  carregando         = signal(false);
  jaCarregou         = signal(false);
  erro               = signal<string | null>(null);

  // ── Handlers de filtro ────────────────────────────────────────────────────

  onCargo(cargo: CargoFiltro) {
    this.cargo.set(cargo);
    this.colaborador.set(null);
    this.registrosOriginais.set([]);
    this.registrosFiltrados.set([]);
    this.jaCarregou.set(false);
    this.erro.set(null);
  }

  onColaborador(colab: Colaborador) {
    this.colaborador.set(colab);
    this.buscar();
  }

  onData(data: string) {
    this.data.set(data);
    if (this.colaborador()) this.buscar();
  }

  onTermoBusca(termo: string) {
    const digits = termo.replace(/\D/g, '');
    if (!digits) {
      this.registrosFiltrados.set(this.registrosOriginais());
    } else {
      this.registrosFiltrados.set(
        this.registrosOriginais().filter(r =>
          (r.cpf || '').replace(/\D/g, '').includes(digits)
        )
      );
    }
  }

  // ── Busca principal ───────────────────────────────────────────────────────

  private buscar() {
    const cargo = this.cargo();
    const colab = this.colaborador();
    const data  = this.data();
    if (!cargo || !colab || !data) return;

    const uid = colab.uid || colab.id;

    this.carregando.set(true);
    this.erro.set(null);
    this.registrosOriginais.set([]);
    this.registrosFiltrados.set([]);

    const obs$ =
      cargo === 'assessor'  ? this.svc.buscarPorAssessor(uid, data)  :
      cargo === 'analista'  ? this.svc.buscarPorAnalista(uid, data)  :
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
      this.registrosFiltrados.set(registros);
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
    return this.colaborador()?.nome || '';
  }
}
