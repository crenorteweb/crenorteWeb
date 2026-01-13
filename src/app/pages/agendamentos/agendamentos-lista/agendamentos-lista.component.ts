import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Auth, user } from '@angular/fire/auth';
import { Agendamento } from '../../../models/agendamento.model';
import { AgendamentoService } from '../../../services/agendamento.service';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { HeaderComponent } from '../../shared/header/header.component';

type SortDir = 'asc' | 'desc';
type SortField = 'clienteNome' | 'dataHora';

@Component({
  selector: 'app-agendamentos-lista',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterModule, FormsModule, HeaderComponent],
  templateUrl: './agendamentos-lista.component.html',
  styleUrls: ['./agendamentos-lista.component.css']
})
export class AgendamentosListaComponent implements OnInit {
  private agService = inject(AgendamentoService);
  private preService = inject(PreCadastroService);
  private auth = inject(Auth);

  loading = signal(true);
  erroCarregar: string | null = null;

  all: Agendamento[] = [];
  rows: Agendamento[] = [];
  pageRows: Agendamento[] = [];

  filtro = { nome: '', dataDe: '', dataAte: '' };
  sortField: SortField = 'dataHora';
  sortDir: SortDir = 'asc';

  paginaAtual = 1;
  pageSize = 10;
  totalPaginas = 1;

  async ngOnInit() {
    this.loading.set(true);
    this.erroCarregar = null;
    try {
      const u = await firstValueFrom(user(this.auth));
      if (!u) { this.all = []; this.recompute(); return; }

      const rows = await this.agService.listarDoAssessor(u.uid);
      this.all = rows ?? [];
      this.recompute();
    } catch (e: any) {
      console.error('[Agendamentos] erro ao listar', e);
      this.all = [];
      this.erroCarregar = 'Não foi possível carregar os agendamentos.';
      this.recompute();
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Helpers gerais =====
  private onlyDigits(v?: string | null): string { return (v ?? '').replace(/\D+/g, ''); }
  whatsHref(v?: string | null): string {
    const d = this.onlyDigits(v);
    if (!d) return '';
    const core = d.startsWith('55') ? d : `55${d}`;
    return `https://wa.me/${core}`;
  }
  toDate(ts: any): Date | null {
    return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
  }
  displayName(v?: string | null) { return (v || '').trim(); }
  maskPhone(v?: string | null) {
    const digits = (v || '').replace(/\D+/g, '');
    if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
    return v || '—';
  }

  // ===== Status helpers =====
  statusKey(a: Agendamento): 'agendado' | 'visitado' | 'nao_agendado' {
    const s = (a as any)?.status as string | undefined;
    if (s === 'visitado' || s === 'nao_agendado' || s === 'agendado') return s;
    return 'agendado';
  }
  statusLabel(a: Agendamento): string {
    const k = this.statusKey(a);
    return k === 'visitado' ? 'Visitado' : k === 'nao_agendado' ? 'Não agendado' : 'Agendado';
  }
  statusBadgeClass(a: Agendamento): string {
    const k = this.statusKey(a);
    if (k === 'visitado') return 'text-bg-success';
    if (k === 'nao_agendado') return 'text-bg-secondary';
    return 'text-bg-info';
  }

  // ===== KPIs =====
  get totalAgendamentos() { return this.all.length; }
  get kpiHoje() {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return this.all.filter(a => {
      const d = this.toDate(a.dataHora); if (!d) return false;
      return d >= today && d < tomorrow;
    }).length;
  }
  get kpiProx7() {
    const now = new Date();
    const end = new Date(); end.setDate(end.getDate() + 7);
    return this.all.filter(a => {
      const d = this.toDate(a.dataHora); if (!d) return false;
      return d >= now && d <= end;
    }).length;
  }
  get kpiFuturos() {
    const now = new Date();
    return this.all.filter(a => {
      const d = this.toDate(a.dataHora); if (!d) return false;
      return d >= now;
    }).length;
  }

  // ===== Filtros / Ordenação / Paginação =====
  onFiltroNomeChange(_: any) { this.aplicarFiltros(true); }
  aplicarFiltros(resetPage = false) {
    let arr = [...this.all];

    const nome = (this.filtro.nome || '').trim().toLowerCase();
    if (nome) arr = arr.filter(a => (a.clienteNome || '').toLowerCase().includes(nome));

    let de: Date | null = null, ate: Date | null = null;
    if (this.filtro.dataDe) { const [y, m, d] = this.filtro.dataDe.split('-').map(Number); de = new Date(y, m-1, d, 0,0,0); }
    if (this.filtro.dataAte) { const [y, m, d] = this.filtro.dataAte.split('-').map(Number); ate = new Date(y, m-1, d, 23,59,59); }
    if (de) arr = arr.filter(a => { const dt = this.toDate(a.dataHora); return !dt || dt >= de; });
    if (ate) arr = arr.filter(a => { const dt = this.toDate(a.dataHora); return !dt || dt <= ate; });

    arr.sort((a, b) => {
      const mul = this.sortDir === 'asc' ? 1 : -1;
      if (this.sortField === 'clienteNome') {
        return mul * this.displayName(a.clienteNome).localeCompare(this.displayName(b.clienteNome));
      } else {
        const da = this.toDate(a.dataHora)?.getTime() ?? 0;
        const db = this.toDate(b.dataHora)?.getTime() ?? 0;
        return mul * (da - db);
      }
    });

    this.rows = arr;
    if (resetPage) this.paginaAtual = 1;
    this.paginar();
  }
  ordenarPor(field: SortField) {
    if (this.sortField === field) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.aplicarFiltros(false);
  }
  paginar() {
    const total = this.rows.length;
    this.totalPaginas = Math.max(1, Math.ceil(total / this.pageSize));
    this.paginaAtual = Math.min(this.paginaAtual, this.totalPaginas);
    const start = (this.paginaAtual - 1) * this.pageSize;
    this.pageRows = this.rows.slice(start, start + this.pageSize);
  }
  pages(): number[] { return Array.from({ length: this.totalPaginas }, (_, i) => i + 1); }
  irParaPagina(p: number) { if (p < 1 || p > this.totalPaginas) return; this.paginaAtual = p; this.paginar(); }
  trackById(_: number, a: Agendamento) { return a.id || `${a.preCadastroId}-${a.dataHora}`; }

  private recompute() { this.aplicarFiltros(true); }

  // ===== Ações =====
  async marcarVisitadoAgendamento(a: Agendamento) {
    if (!a?.preCadastroId || !a?.id) return;

    try {
      // 1) status do agendamento
      await this.agService.atualizar(a.id, { status: 'visitado' } as any);
      (a as any).status = 'visitado';

      // 2) tenta sincronizar o pré; se não existir, ignora
      try {
        await this.preService.atualizar(a.preCadastroId, { agendamentoStatus: 'visitado' } as any);
      } catch (e: any) {
        if (e?.code === 'not-found' || /No document to update/i.test(e?.message || '')) {
          console.warn('[Agendamentos] pré-cadastro não existe mais, ignorando sync.');
        } else {
          throw e;
        }
      }

      alert('Agendamento marcado como visitado.');
    } catch (e) {
      console.error('[Agendamentos] erro ao marcar visitado', e);
      alert('Não foi possível marcar como visitado.');
    }
  }

  async deletarAgendamento(a: Agendamento) {
    if (!a?.id) return;
    const ok = confirm(`Excluir agendamento de "${a.clienteNome || 'cliente'}" em ${this.toDate(a.dataHora)?.toLocaleString('pt-BR') || ''}?`);
    if (!ok) return;

    const preId = a.preCadastroId;

    try {
      // 1) remove o agendamento
      await this.agService.remover(a.id);

      // 2) tenta “desvincular” o pré; se não existir, tudo bem
      if (preId) {
        try {
          await this.preService.atualizar(preId, {
            agendamentoStatus: 'nao_agendado',
            agendamentoId: null as any
          } as any);
        } catch (e: any) {
          if (e?.code === 'not-found' || /No document to update/i.test(e?.message || '')) {
            console.warn('[Agendamentos] pré-cadastro não existe mais, ignorando sync.');
          } else {
            throw e;
          }
        }
      }

      // 3) reflete na UI
      this.all = this.all.filter(x => x.id !== a.id);
      this.aplicarFiltros(false);
      alert('Agendamento excluído.');
    } catch (e) {
      console.error('[Agendamentos] erro ao excluir', e);
      alert('Não foi possível excluir o agendamento.');
    }
  }
}
