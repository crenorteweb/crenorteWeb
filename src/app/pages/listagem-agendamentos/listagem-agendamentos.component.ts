import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection,
  collectionGroup,
  getDocs,
  getCountFromServer,
  deleteDoc,
  doc,
  QuerySnapshot,
  DocumentData,
  Timestamp,
  updateDoc
} from 'firebase/firestore';

import { db } from '../../firebase.config';
import { HeaderComponent } from '../shared/header/header.component';

declare const bootstrap: any;

type SortDir = 'asc' | 'desc';

type Agendamento = {
  id: string;
  _path: string;

  assessorNome?: string;      // pode vir como nome ou e-mail
  assessorUid?: string;
  assessorEmail?: string;

  clienteNome?: string;
  clienteTelefone?: string;
  clienteBairro?: string;
  clienteEndereco?: string;

  status?: string;

  dataHora?: any;             // Timestamp | Date | ISO | "23 de setembro de 2025 às 09:00:00 UTC-3"
  createdAt?: any;

  // legado
  data?: any;
  hora?: string | null;
};

type AgendamentoVM = Agendamento & {
  vClienteNome: string;
  vAssessorNome: string;
  vTelefone: string;
  vData: string;
  vHora: string;
  vBairro: string;
};

@Component({
  selector: 'app-listagem-agendamentos',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  styleUrls: ['./listagem-agendamentos.component.css'],
  templateUrl: './listagem-agendamentos.component.html',
})
export class ListagemAgendamentosComponent implements OnInit {
  constructor(private cdr: ChangeDetectorRef) {}

  // fonte
  agendsAll: Agendamento[] = [];
  agendsFiltrados: Agendamento[] = [];

  // compat: alguns templates antigos usam isto
  agendsPaginados: Agendamento[] = [];

  // render novo (ViewModel)
  rows: AgendamentoVM[] = [];

  // filtros
  filtro: {
    nome: string;
    dataDe?: string;
    dataAte?: string;
    status: string;
    assessor: string;
    bairro: string;
  } = { nome: '', dataDe: '', dataAte: '', status: '', assessor: '', bairro: '' };

  // opções
  statusDisponiveis: string[] = [];
  assessoresDisponiveis: string[] = [];
  bairrosDisponiveis: string[] = [];

  itensPorPagina = 20;
  paginaAtual = 1;
  totalPaginas = 1;
  totalEstimado = 0;

  sortField: 'dataHora' | 'clienteNome' | 'assessorNome' | 'clienteBairro' | 'status' = 'dataHora';
  sortDir: SortDir = 'desc';

  carregando = false;
  erroCarregar = '';

  // modal edição
  selected: Agendamento | null = null;
  selectedVM: AgendamentoVM | null = null;
  formData = ''; // yyyy-MM-dd
  formHora = ''; // HH:mm

  // colaboradores
  private colaboradoresPorUid = new Map<string, string>();
  private colaboradoresPorEmail = new Map<string, string>();

  async ngOnInit(): Promise<void> {
    await this.carregarTodos();
  }

  // ================= Utils (públicos pois alguns templates chamam direto) ================
  normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '—';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keepLower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keepLower.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11) return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }

  // bairros: sinônimos → canônico
  private canonicalizarBairro(raw?: string): string {
    const n = this.normalize(raw || '');
    if (!n) return '—';
    if (n.includes('guama')) return 'Guamá';
    if (n.includes('curio')) return 'Curió-Utinga';
    if (n.includes('uting')) return 'Curió-Utinga';
    if (n.includes('marco')) return 'Marco';
    if (n.includes('sacramenta')) return 'Sacramenta';
    return this.displayName(raw || '');
  }
  private extrairBairroDeEndereco(endereco: string): string {
    const m1 = endereco.match(/bairro[:\s-]*([^,-]+)/i);
    if (m1?.[1]) return m1[1].trim();
    const m2 = endereco.split(' - ')[0];
    return m2?.trim() || '';
  }

  // datas
  private readonly PT_MESES: Record<string, number> = {
    janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };
  private parsePtBrLongDateTime(s: string): Date | null {
    if (!s) return null;
    const norm = s.trim().replace(/\s+UTC[^\s]+$/i, '').replace(/\,/g, '');
    const re = /^(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})(?:\s+às\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i;
    const m = norm.match(re);
    if (!m) return null;
    const dd = +m[1];
    const mesNome = m[2].toLowerCase();
    const yyyy = +m[3];
    const h = m[4] ? +m[4] : 0;
    const min = m[5] ? +m[5] : 0;
    const sec = m[6] ? +m[6] : 0;
    const mm = this.PT_MESES[mesNome];
    if (mm == null) return null;
    return new Date(yyyy, mm, dd, h, min, sec, 0);
  }
  private asDateFlexible(v: any): Date | null {
    if (!v) return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try { return v.toDate(); } catch {}
    }
    if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const iso = new Date(v);
      if (!isNaN(iso.getTime())) return iso;
      const m1 = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m1) {
        const [, dd, mm, yyyy] = m1;
        return new Date(+yyyy, +mm - 1, +dd);
      }
      const dLong = this.parsePtBrLongDateTime(v);
      if (dLong) return dLong;
    }
    return null;
  }

  toBRDate(d?: Date | null): string {
    if (!d) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  toBRTimeFromDate(d?: Date | null): string {
    if (!d) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ======== nomes/horário públicos (compat com template antigo) ========
// Troque pela versão "à prova de null"
getAssessorNome(a?: Agendamento | null): string {
  if (!a) return '—';
  const uid = a.assessorUid || null;

  // 1) por UID → colaboradores
  if (uid) {
    const nome = this.colaboradoresPorUid.get(uid);
    if (nome) return this.displayName(nome);
  }

  // 2) e-mail salvo → colaboradores
  const emailRaw = (a.assessorEmail ?? a.assessorNome ?? '').toString();
  if (emailRaw && emailRaw.includes('@')) {
    const nome = this.colaboradoresPorEmail.get(this.normalize(emailRaw));
    if (nome) return this.displayName(nome);
  }

  // 3) já é nome
  if (a.assessorNome && !a.assessorNome.includes('@')) return this.displayName(a.assessorNome);

  // 4) fallback
  if (uid) return `UID: ${uid.slice(0, 6)}…`;
  return '—';
}

getBairro(a?: Agendamento | null): string {
  if (!a) return '—';
  const b = a.clienteBairro || this.extrairBairroDeEndereco(a.clienteEndereco || '');
  return this.canonicalizarBairro(b);
}

getDataHoraDate(a?: Agendamento | null): Date | null {
  if (!a) return null;
  if (a.dataHora) {
    const d = this.asDateFlexible(a.dataHora);
    if (d) return d;
  }
  const d2 = this.asDateFlexible(a.data);
  if (!d2) return null;
  const hora = (a.hora || '').toString().trim();
  const m = hora.match(/^(\d{1,2}):(\d{2})$/);
  if (m) d2.setHours(Math.min(23, +m[1]), Math.min(59, +m[2]), 0, 0);
  return d2;
}


  private toVM(a: Agendamento): AgendamentoVM {
    const dt = this.getDataHoraDate(a);
    return {
      ...a,
      vClienteNome: this.displayName(a.clienteNome || '—'),
      vAssessorNome: this.getAssessorNome(a),
      vTelefone: this.maskPhone(a.clienteTelefone),
      vData: this.toBRDate(dt),
      vHora: this.toBRTimeFromDate(dt),
      vBairro: this.getBairro(a),
    };
  }

  // ====================== Carga ======================
  private async carregarColaboradores() {
    const snap = await getDocs(collection(db, 'colaboradores'));
    snap.forEach((d) => {
      const data: any = d.data();
      const uid = (data?.uid || '').toString();
      const email = (data?.email || '').toString();
      const nome = (data?.nome || '').toString();
      if (uid && nome) this.colaboradoresPorUid.set(uid, nome);
      if (email && nome) this.colaboradoresPorEmail.set(this.normalize(email), nome);
    });
  }

  private async carregarTodos() {
    this.carregando = true;
    this.erroCarregar = '';
    this.agendsAll = [];
    this.agendsFiltrados = [];
    this.agendsPaginados = [];
    this.rows = [];
    this.paginaAtual = 1;
    this.cdr.detectChanges();

    try {
      // 1) colaboradores primeiro
      await this.carregarColaboradores();

      // 2) contagem
      try {
        const countSnap = await getCountFromServer(collectionGroup(db, 'agendamentos'));
        this.totalEstimado = (countSnap.data() as any).count || 0;
      } catch {
        const countTop = await getCountFromServer(collection(db, 'agendamentos'));
        this.totalEstimado = (countTop.data() as any).count || 0;
      }

      // 3) buscar docs
      const found: Record<string, true> = {};
      let snapGroup: QuerySnapshot<DocumentData> | null = null;
      try {
        snapGroup = await getDocs(collectionGroup(db, 'agendamentos'));
      } catch {}

      if (snapGroup && !snapGroup.empty) {
        snapGroup.forEach((d) => {
          const dados = d.data() as any;
          this.agendsAll.push({ id: d.id, _path: d.ref.path, ...dados });
          found[d.ref.path] = true;
        });
      }

      const snapTop = await getDocs(collection(db, 'agendamentos'));
      snapTop.forEach((d) => {
        const key = d.ref.path;
        if (found[key]) return;
        const dados = d.data() as any;
        this.agendsAll.push({ id: d.id, _path: d.ref.path, ...dados });
      });

      // 4) opções dinâmicas
      this.statusDisponiveis = Array.from(
        new Set(this.agendsAll.map(a => (a.status || '').toString().trim()).filter(Boolean))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      this.assessoresDisponiveis = Array.from(
        new Set(this.agendsAll.map(a => this.getAssessorNome(a)).filter(n => n && n !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      this.bairrosDisponiveis = Array.from(
        new Set(this.agendsAll.map(a => this.getBairro(a)).filter(b => b && b !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      // 5) filtros e paginação (monta rows e agendsPaginados)
      await Promise.resolve();
      this.aplicarFiltrosLocais(true);
      this.cdr.detectChanges();
      setTimeout(() => this.cdr.detectChanges(), 0);
    } catch (e) {
      console.error(e);
      this.erroCarregar = 'Erro ao carregar os agendamentos do Firebase.';
    } finally {
      this.carregando = false;
      this.cdr.detectChanges();
    }
  }

  // ====================== filtros/ordenação/paginação ======================
  onFiltroNomeChange(v: string) {
    this.filtro.nome = v;
    this.aplicarFiltrosLocais();
  }

  aplicarFiltrosLocais(resetPagina = false) {
    let arr = [...this.agendsAll];
    const nl = this.normalize(this.filtro.nome);

    if (nl) arr = arr.filter(a => this.normalize(this.displayName(a.clienteNome || '')).includes(nl));

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const start = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const end = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter(a => {
        const d = this.getDataHoraDate(a);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    if (this.filtro.status) {
      const alvo = this.normalize(this.filtro.status);
      arr = arr.filter(a => this.normalize(a.status || '') === alvo);
    }

    if (this.filtro.assessor) {
      const alvo = this.normalize(this.filtro.assessor);
      arr = arr.filter(a => this.normalize(this.getAssessorNome(a)) === alvo);
    }

    if (this.filtro.bairro) {
      const alvoB = this.normalize(this.filtro.bairro);
      arr = arr.filter(a => this.normalize(this.getBairro(a)) === alvoB);
    }

    // ordenar
    const mult = this.sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va: any, vb: any;
      if (this.sortField === 'dataHora') {
        va = this.getDataHoraDate(a)?.getTime() ?? 0;
        vb = this.getDataHoraDate(b)?.getTime() ?? 0;
      } else if (this.sortField === 'assessorNome') {
        va = this.normalize(this.getAssessorNome(a));
        vb = this.normalize(this.getAssessorNome(b));
      } else if (this.sortField === 'clienteBairro') {
        va = this.normalize(this.getBairro(a));
        vb = this.normalize(this.getBairro(b));
      } else if (this.sortField === 'status') {
        va = this.normalize(a.status || '');
        vb = this.normalize(b.status || '');
      } else {
        va = this.normalize(this.displayName(a.clienteNome || ''));
        vb = this.normalize(this.displayName(b.clienteNome || ''));
      }
      if (va < vb) return -1 * mult;
      if (va > vb) return  1 * mult;
      return 0;
    });

    this.agendsFiltrados = arr;
    if (resetPagina) this.paginaAtual = 1;
    this.recalcularPaginacao();
    this.cdr.detectChanges();
  }

  ordenarPor(campo: 'dataHora' | 'clienteNome' | 'assessorNome' | 'clienteBairro' | 'status') {
    if (this.sortField === campo) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = campo; this.sortDir = 'asc'; }
    this.aplicarFiltrosLocais();
  }

  private recalcularPaginacao() {
    this.totalPaginas = Math.max(1, Math.ceil(this.agendsFiltrados.length / this.itensPorPagina));
    if (this.paginaAtual > this.totalPaginas) this.paginaAtual = this.totalPaginas;
    const ini = (this.paginaAtual - 1) * this.itensPorPagina;
    const fim = ini + this.itensPorPagina;

    // compat (HTML antigo)
    this.agendsPaginados = this.agendsFiltrados.slice(ini, fim);

    // render novo (VM)
    this.rows = this.agendsPaginados.map(a => this.toVM(a));

    this.cdr.detectChanges();
  }

  irParaPagina(n: number) {
    if (n < 1 || n > this.totalPaginas || n === this.paginaAtual) return;
    this.paginaAtual = n;
    this.recalcularPaginacao();
    try {
      document.querySelector('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
  }
  pages(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }

  // compat (HTML antigo)
  trackById(_i: number, a: Agendamento) {
    return a._path || a.id;
  }

  // ====================== Editar / Remover ======================
  abrirModalEditar(r: Agendamento | AgendamentoVM) {
    // r pode ser VM ou modelo cru; ambos têm os campos necessários
    this.selected = r as Agendamento;
    this.selectedVM = this.toVM(this.selected);

    const d = this.getDataHoraDate(this.selected) || this.asDateFlexible(this.selected.createdAt) || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    this.formData = `${yyyy}-${mm}-${dd}`;
    this.formHora = `${hh}:${mi}`;
    this.cdr.detectChanges();
  }

  async salvarDataHora() {
    if (!this.selected || !this.formData || !this.formHora) return;

    const [Y, M, D] = this.formData.split('-').map((n) => +n);
    const [h, m] = this.formHora.split(':').map((n) => +n);
    const nova = new Date(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0, 0, 0);
    const path = this.selected._path || `agendamentos/${this.selected.id}`;

    try {
      await updateDoc(doc(db, path), { dataHora: Timestamp.fromDate(nova) });

      // atualiza em memória
      this.selected.dataHora = Timestamp.fromDate(nova);

      // atualiza coleções
      const key = (x: Agendamento) => (x._path || x.id);
      this.agendsAll = this.agendsAll.map(x => key(x) === key(this.selected!) ? { ...x, dataHora: this.selected!.dataHora } : x);
      this.aplicarFiltrosLocais();

      // fecha modal
      try {
        const el = document.getElementById('modalEditarAgendamento');
        const modal = bootstrap?.Modal?.getOrCreateInstance(el);
        modal?.hide();
      } catch {}
      this.cdr.detectChanges();
    } catch (e) {
      console.error(e);
      alert('Falha ao atualizar a data/hora do agendamento.');
    }
  }

  async removerAgendamento(r: Agendamento | AgendamentoVM) {
    const ok = window.confirm('Tem certeza que deseja remover este agendamento?');
    if (!ok) return;
    const path = (r as Agendamento)._path || `agendamentos/${(r as Agendamento).id}`;
    await deleteDoc(doc(db, path));

    const key = (x: Agendamento) => (x._path || x.id);
    this.agendsAll = this.agendsAll.filter(x => key(x) !== key(r as Agendamento));
    this.aplicarFiltrosLocais();
    this.cdr.detectChanges();
  }
}
