import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GrupoSolidario, StatusGrupo } from '../../../models/grupo.model';

type SortDir = 'asc' | 'desc';

@Component({
  standalone: true,
  selector: 'app-grupos-relatorio',
  templateUrl: './grupos-relatorio.component.html',
  styleUrls: ['./grupos-relatorio.component.css'],
  imports: [CommonModule, FormsModule],
})
export class GruposRelatorioComponent implements OnInit {
  // estado
  carregando = false;
  erro = '';

  // dados
  gruposAll: GrupoSolidario[] = [];
  gruposFiltrados: GrupoSolidario[] = [];
  gruposPaginados: GrupoSolidario[] = [];

  // filtros
  filtro: { nome: string; cpf: string; status: '' | StatusGrupo } = {
    nome: '',
    cpf: '',
    status: '',
  };

  // ordenação
  sortField: 'nome' | 'criadoEm' = 'criadoEm';
  sortDir: SortDir = 'desc';

  // paginação
  paginaAtual = 1;
  porPagina = 20;
  totalPaginas = 1;

  async ngOnInit() {
    await this.carregarTodos();
  }

  // ==== Helpers de UI usados no HTML ====
  statusLabel(s?: StatusGrupo) {
    return s === 'aprovado_basa' ? 'Aprovado BASA'
         : s === 'reprovado_basa' ? 'Reprovado BASA'
         : 'Em QA';
  }
  statusClass(s?: StatusGrupo) {
    return s === 'aprovado_basa' ? 'bg-success-subtle text-success border'
         : s === 'reprovado_basa' ? 'bg-danger-subtle text-danger border'
         : 'bg-warning-subtle text-warning border';
  }
  maskCpf(cpf?: string) {
    const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (cpf || '');
  }
  toBRDate(v: any) {
    const d = this.asDate(v);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  // ==== Dados (plugue o Firestore aqui) ====
  async carregarTodos() {
    try {
      this.carregando = true;
      this.erro = '';

      // TODO: substituir pela busca real no Firestore
      // this.gruposAll = await listarGruposDoFirestore();
      this.gruposAll = [];

      this.aplicarFiltros(true);
    } catch (e:any) {
      console.error(e);
      this.erro = 'Falha ao carregar grupos.';
    } finally {
      this.carregando = false;
    }
  }

  aplicarFiltros(reset = false) {
    const norm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

    const nome = norm(this.filtro.nome);
    const cpf = (this.filtro.cpf || '').replace(/\D/g, '');
    const st = this.filtro.status;

    let arr = [...this.gruposAll];

    if (nome) {
      arr = arr.filter(g => norm(g.coordenadorNome || '').includes(nome));
    }
    if (cpf) {
      arr = arr.filter(g => (g.coordenadorCpf || '').includes(cpf));
    }
    if (st) {
      arr = arr.filter(g => g.status === st);
    }

    this.gruposFiltrados = this.sortArray(arr, this.sortField, this.sortDir);
    if (reset) this.paginaAtual = 1;
    this.recalcPaginacao();
  }

  ordenarPor(field: 'nome' | 'criadoEm') {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'asc';
    }
    this.gruposFiltrados = this.sortArray(this.gruposFiltrados, this.sortField, this.sortDir);
    this.recalcPaginacao();
  }

  private sortArray(arr: GrupoSolidario[], field: 'nome' | 'criadoEm', dir: SortDir) {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any, vb: any;
      if (field === 'nome') {
        va = (a.coordenadorNome || '').toLowerCase();
        vb = (b.coordenadorNome || '').toLowerCase();
      } else {
        const da = this.asDate(a.criadoEm)?.getTime() ?? 0;
        const db = this.asDate(b.criadoEm)?.getTime() ?? 0;
        va = da; vb = db;
      }
      if (va < vb) return -1 * mult;
      if (va > vb) return  1 * mult;
      return 0;
    });
  }

  private asDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof v.seconds === 'number') {
      return new Date(v.seconds * 1000);
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  private recalcPaginacao() {
    this.totalPaginas = Math.max(1, Math.ceil(this.gruposFiltrados.length / this.porPagina));
    if (this.paginaAtual > this.totalPaginas) this.paginaAtual = this.totalPaginas;
    const ini = (this.paginaAtual - 1) * this.porPagina;
    const fim = ini + this.porPagina;
    this.gruposPaginados = this.gruposFiltrados.slice(ini, fim);
  }

  irParaPagina(p: number) {
    if (p < 1 || p > this.totalPaginas || p === this.paginaAtual) return;
    this.paginaAtual = p;
    this.recalcPaginacao();
  }

  pages(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }
}
