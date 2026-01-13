import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { listarPorStatus, setStatusClienteById } from '../../services/cadastro.service';
import type { Cliente, StatusCadastro } from '../../models/cliente.model';
import { getAuth } from 'firebase/auth';
import { Router } from '@angular/router';

type ClienteDoc = Cliente & {
  id: string;
  anexos?: Record<string, string[]>;
  valorSolicitadoFormatado?: string;
};

type Tab = 'em_analise' | 'aprovado' | 'reprovado' | 'todos';
type SortDir = 'asc' | 'desc';

type CampoDetalhe = {
  key: string;
  label: string;
  value: any;
  kind?: 'cpf' | 'money' | 'date' | 'bool' | 'text';
};

@Component({
  selector: 'app-aprovacoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './aprovacoes.component.html',
  styleUrls: ['./aprovacoes.component.css'],
})
export class AprovacoesComponent implements OnInit {
  constructor(private router: Router) {}

  // Estado UI
  carregando = false;
  erro = '';

  tabs: { key: Tab; label: string }[] = [
    { key: 'em_analise', label: 'Em Análise' },
    { key: 'aprovado', label: 'Aprovados' },
    { key: 'reprovado', label: 'Reprovados' },
    { key: 'todos', label: 'Todos' },
  ];
  tabAtual: Tab = 'em_analise';

  // Busca rápida e filtros “listagem-like”
  busca = '';
  filtro = {
    nome: '',
    dataDe: '' as string | '',
    dataAte: '' as string | '',
  };

  // Ordenação
  sortField: 'nomeCompleto' | 'dataPreenchimento' = 'dataPreenchimento';
  sortDir: SortDir = 'desc';

  // Dados
  itens: ClienteDoc[] = [];
  itensFiltrados: ClienteDoc[] = [];

  // Modal
  modalOpen = false;
  current?: ClienteDoc;
  obsReprovacao = '';

  // trackBy / trigger
  trackById = (_: number, c: any) => c?.id || c?.cpf || _;
  refreshKey = signal(0);

  async ngOnInit(): Promise<void> {
    await this.carregar();
  }

  // ========= Carregar =========
  async carregar() {
    this.carregando = true;
    this.erro = '';
    try {
      const status: StatusCadastro | undefined =
        this.tabAtual === 'todos' ? undefined : (this.tabAtual as StatusCadastro);
      this.itens = await listarPorStatus(status) as ClienteDoc[];
      this.aplicarFiltro(true);
    } catch (e) {
      console.error(e);
      this.erro = 'Falha ao carregar aprovações.';
    } finally {
      this.carregando = false;
    }
  }

  trocarTab(t: Tab) {
    if (this.tabAtual === t) return;
    this.tabAtual = t;
    this.carregar();
  }

  // ========= Filtros / Ordenação =========
  aplicarFiltro(reset = false) {
    const q = this.normalize(this.busca);
    let arr = !q
      ? [...this.itens]
      : this.itens.filter((c) =>
          this.normalize(this.displayName(c.nomeCompleto)).includes(q) ||
          (c.cpf || '').includes(q) ||
          this.normalize(c.cidade || '').includes(q)
        );

    const fnome = this.normalize(this.filtro.nome || '');
    if (fnome) {
      arr = arr.filter((c) =>
        this.normalize(this.displayName(c.nomeCompleto)).includes(fnome)
      );
    }

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const start = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const end = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter((c) => {
        const d = this.asDate(c.dataPreenchimento);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    this.itensFiltrados = this.sortArray(arr, this.sortField, this.sortDir);

    if (reset) {
      // reservado para paginação futura
    }

    this.refreshKey.set(this.refreshKey() + 1);
  }

  ordenarPor(field: 'nomeCompleto' | 'dataPreenchimento') {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'asc';
    }
    this.itensFiltrados = this.sortArray(this.itensFiltrados, this.sortField, this.sortDir);
    this.refreshKey.set(this.refreshKey() + 1);
  }

  private sortArray(arr: ClienteDoc[], field: 'nomeCompleto' | 'dataPreenchimento', dir: SortDir) {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any;
      let vb: any;

      if (field === 'dataPreenchimento') {
        va = this.asDate(a.dataPreenchimento)?.getTime() ?? 0;
        vb = this.asDate(b.dataPreenchimento)?.getTime() ?? 0;
      } else {
        va = this.displayName(a.nomeCompleto).toLowerCase();
        vb = this.displayName(b.nomeCompleto).toLowerCase();
      }

      if (va < vb) return -1 * mult;
      if (va > vb) return  1 * mult;
      return 0;
    });
  }

  // ========= Ações =========
  openModal(c: ClienteDoc) {
    this.current = c;
    this.obsReprovacao = '';
    this.modalOpen = true;
  }
  closeModal() {
    this.modalOpen = false;
    this.current = undefined;
    this.obsReprovacao = '';
  }

  async manterAnalise() {
    if (!this.current) return;
    await this._setStatus('em_analise');
  }

  async aprovar() {
    if (!this.current) return;
    await this._setStatus('aprovado');
  }

  async reprovar() {
    if (!this.current) return;
    const note = (this.obsReprovacao || '').trim();
    if (!note) {
      alert('Por favor, informe a observação da reprovação.');
      return;
    }
    await this._setStatus('reprovado', note);
  }

  private async _setStatus(to: StatusCadastro, note?: string) {
    if (!this.current) return;
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      const metaUser = {
        uid: user?.uid || 'sem-uid',
        nome: user?.displayName || user?.email || 'Usuário',
      };

      await setStatusClienteById(this.current.id, to, metaUser, note);
      await this.carregar();
      this.closeModal();
    } catch (e) {
      console.error(e);
      alert('Falha ao atualizar status.');
    }
  }

  // ========= Helpers UI =========
  statusLabel(s?: string) {
    return s === 'aprovado' ? 'Aprovado'
         : s === 'reprovado' ? 'Reprovado'
         : 'Em Análise';
  }
  statusClass(s?: string) {
    return s === 'aprovado' ? 'bg-success-subtle text-success border'
         : s === 'reprovado' ? 'bg-danger-subtle text-danger border'
         : 'bg-warning-subtle text-warning border';
  }

  displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keepLower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts
      .map((p, i) => (i > 0 && keepLower.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  }
  normalize(s?: string) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  toBRDate(value: any): string {
    const d = this.asDate(value);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  private asDate(input: any): Date | null {
    if (!input) return null;
    if (typeof input === 'object' && typeof (input as any).seconds === 'number') {
      const i = input as { seconds: number; nanoseconds?: number };
      const ms = i.seconds * 1000 + Math.floor((i.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }
    if (input instanceof Date) return input;
    if (typeof input === 'string') {
      const s = input.trim();
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const dd = +m[1], mm = +m[2], yyyy = +m[3];
        const d = new Date(yyyy, mm - 1, dd);
        if (!isNaN(d.getTime())) return d;
      }
      const d2 = new Date(s);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  maskCPF(cpf?: string): string {
    const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
    if (d.length !== 11) return cpf || '';
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  // --------- Detalhes do cadastro no modal ----------
  valorSolicitadoFmt(c: ClienteDoc): string {
    const v: any = (c && (c as any).valorSolicitadoFormatado) ?? c?.valorSolicitado;
    return this.formatMoney(v);
  }

  formatMoney(v: any): string {
    if (v == null || v === '') return '—';
    const num = typeof v === 'number' ? v : Number(v);
    if (isNaN(num)) return String(v);
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num);
    } catch {
      return String(v);
    }
  }

  /** Monta uma lista de campo/valor com os principais e inclui os demais primitivos. */
  detalheCampos(c: ClienteDoc): CampoDetalhe[] {
    if (!c) return [];
    const ordered: CampoDetalhe[] = [];

    const pushIf = (key: string, label: string, value: any, kind?: CampoDetalhe['kind']) => {
      if (value !== undefined && value !== null && value !== '') {
        ordered.push({ key, label, value, kind: kind || 'text' });
      }
    };

    // Principais (em ordem)
    pushIf('nomeCompleto', 'Nome completo', this.displayName(c.nomeCompleto));
    pushIf('cpf', 'CPF', c.cpf, 'cpf');
    pushIf('contato', 'Contato', (c as any).contato);
    pushIf('telefone', 'Telefone', (c as any).telefone);
    pushIf('email', 'E-mail', (c as any).email);
    pushIf('cidade', 'Cidade', (c as any).cidade);
    pushIf('estado', 'Estado', (c as any).estado);
    pushIf('endereco', 'Endereço', (c as any).endereco);
    pushIf('bairro', 'Bairro', (c as any).bairro);
    pushIf('cep', 'CEP', (c as any).cep);
    pushIf('valorSolicitado', 'Valor solicitado', (c as any).valorSolicitado, 'money');
    pushIf('dataPreenchimento', 'Preenchido em', (c as any).dataPreenchimento, 'date');
    pushIf('status', 'Status', (c as any).status);

    // Alguns booleanos comuns
    pushIf('jaEmpreende', 'Já empreende?', (c as any).jaEmpreende, 'bool');
    pushIf('clienteCrenorte', 'Cliente Crenorte?', (c as any).clienteCrenorte, 'bool');

    // Demais chaves primárias que não sejam objetos/arrays grandes
    const known = new Set(ordered.map(o => o.key).concat(['id', 'anexos', 'statusHistory']));
    Object.keys(c).forEach(k => {
      if (known.has(k)) return;
      const v: any = (c as any)[k];
      if (v === null || v === undefined) return;
      if (typeof v === 'object') return; // evita objetos grandes; ficam no JSON debug
      pushIf(k, this.labelize(k), v);
    });

    return ordered;
  }

  private labelize(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  firstUrl(keys: string[]): string | null {
    const a = this.current?.anexos;
    if (!a) return null;
    for (const k of keys) {
      const arr = a[k];
      if (Array.isArray(arr) && arr.length && typeof arr[0] === 'string') return arr[0];
    }
    return null;
  }

  async criarGrupo() {
    if (!this.current) return;
    this.router.navigate(['/grupos/novo'], { queryParams: { coordenadorId: this.current.id } });
  }
}
