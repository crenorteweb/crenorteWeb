// src/app/pages/grupos/criar-grupo.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GrupoSolidarioService } from '../../services/grupo-solidario.service';
import { PreCadastro } from '../../models/pre-cadastro.model';
import { HeaderComponent } from '../shared/header/header.component';
import type { GrupoStatus } from '../../models/grupo-solidario.model';

type SortDir = 'asc' | 'desc';
type GrupoSituacao = 'aprovado' | 'incompleto' | 'inapto';
type SvcGrupoStatus = Parameters<GrupoSolidarioService['definirStatusGrupo']>[1];


type PreviewMembro = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  aprovacao: 'Apto' | 'Inapto' | 'Pendente' | '—';
};

type PreviewGrupo = {
  nome: string;
  coordenadorNome: string;
  coordenadorUid: string | null;
  cidade: string;
  uf: string;
  capacidadeMin: number;
  capacidadeMax: number;
  totalSelecionados: number;
  situacao: GrupoSituacao;
  membros: PreviewMembro[];
};

@Component({
  standalone: true,
  selector: 'app-criar-grupo',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './criar-grupo.component.html',
  styleUrls: ['./criar-grupo.component.css'],
})
export class CriarGrupoComponent implements OnInit {
  // filtros base (datas)
  de = '';
  ate = '';

  // mensagem de sucesso (para alert no HTML)
  successMsg: string | null = null;

  carregando = false;
  aptos = signal<PreCadastro[]>([]);
  aptosFiltrados = signal<PreCadastro[]>([]);
  selecionados = new Set<string>();

  // combos dinâmicos (preenchidos a partir de aptos)
  origensDisponiveis: string[] = [];
  bairrosDisponiveis: string[] = [];
  cidadesDisponiveis: string[] = [];
  ufsDisponiveis: string[] = [];
  assessoresDisponiveis: string[] = [];
  agStatusDisponiveis: string[] = [];

  // filtros avançados (iguais à listagem)
  filtro = {
    nome: '',
    dataDe: '' as string | '',
    dataAte: '' as string | '',
    agendado: 'todos' as 'todos' | 'sim' | 'nao',
    origem: '',
    bairro: '',
    cidade: '',
    uf: '',
    assessor: '',
    agDataDe: '' as string | '',
    agDataAte: '' as string | '',
    agStatus: '',
  };

  // ordenação dos cards (opcional)
  sortField: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro' = 'createdAt';
  sortDir: SortDir = 'desc';

  // dados do grupo
  nome = '';
  cidade = '';
  uf = '';
  capacidadeMin = 3;
  capacidadeMax = 10;

  // coordenador automático: primeiro selecionado
  coordenadorNome = '';
  coordenadorUid: string | null = null;

  // resultado
  grupoCriadoUrl: string | null = null;

  // só para compatibilidade com o template
  visualizacao: 'cards' = 'cards';

  // Modal de pré-visualização
  showCreateModal = false;
  preview: PreviewGrupo | null = null;

  // copy link toast
  toastMsg: string | null = null;

  constructor(private svc: GrupoSolidarioService) { }

  async ngOnInit(): Promise<void> {
    await this.buscar();
  }

  // =================== Carrega aptos ===================
  async buscar() {
    this.carregando = true;
    try {
      const lista = await this.svc.listarAptosPorPeriodo(this.de || null, this.ate || null);
      this.aptos.set(lista || []);
      this.recalcularCombos();
      this.aplicarFiltrosLocais(true);
    } finally {
      this.carregando = false;
    }
  }

  // =================== Filtros locais ===================
  onFiltroNomeChange(v: string) { this.filtro.nome = v; this.aplicarFiltrosLocais(); }

  aplicarFiltrosLocais(_reset = false) {
    let arr = [...this.aptos()];

    const nl = this.normalize(this.filtro.nome);
    if (nl) arr = arr.filter(c => this.normalize(this.displayName(c.nomeCompleto || '')).includes(nl));

    if (this.filtro.agendado !== 'todos') {
      const want = this.filtro.agendado === 'sim';
      arr = arr.filter(c => this.isAgendado(c) === want);
    }

    if (this.filtro.origem) arr = arr.filter(c => this.normalize(this.getOrigem(c)) === this.normalize(this.filtro.origem));
    if (this.filtro.bairro) arr = arr.filter(c => this.normalize(this.getBairro(c)) === this.normalize(this.filtro.bairro));
    if (this.filtro.cidade) arr = arr.filter(c => this.normalize(this.getCidade(c)) === this.normalize(this.filtro.cidade));
    if (this.filtro.uf) arr = arr.filter(c => this.getUF(c).toUpperCase() === this.filtro.uf.toUpperCase());
    if (this.filtro.assessor) arr = arr.filter(c => this.normalize(this.getAssessorNome(c)) === this.normalize(this.filtro.assessor));

    if (this.filtro.agStatus) arr = arr.filter(c => this.normalize(this.getAgendaStatus(c)) === this.normalize(this.filtro.agStatus));

    if (this.filtro.agDataDe || this.filtro.agDataAte) {
      const d0 = this.filtro.agDataDe ? new Date(this.filtro.agDataDe + 'T00:00:00') : null;
      const d1 = this.filtro.agDataAte ? new Date(this.filtro.agDataAte + 'T23:59:59.999') : null;
      arr = arr.filter(c => {
        const d = this.getAgendaDateTime(c);
        if (!d) return false;
        if (d0 && d < d0) return false;
        if (d1 && d > d1) return false;
        return true;
      });
    }

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const c0 = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const c1 = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter(c => {
        const d = this.asDateFlexible(c.createdAt);
        if (!d) return false;
        if (c0 && d < c0) return false;
        if (c1 && d > c1) return false;
        return true;
      });
    }

    // ordena (opcional)
    arr = this.ordenarArray(arr, this.sortField, this.sortDir);

    this.aptosFiltrados.set(arr);
  }

  ordenarPor(campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro') {
    if (this.sortField === campo) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = campo; this.sortDir = 'asc'; }
    this.aplicarFiltrosLocais();
  }

  private ordenarArray(arr: PreCadastro[], campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro', dir: SortDir): PreCadastro[] {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a: any, b: any) => {
      let va: any, vb: any;
      if (campo === 'createdAt') { va = this.asDateFlexible(a.createdAt)?.getTime() ?? 0; vb = this.asDateFlexible(b.createdAt)?.getTime() ?? 0; }
      else if (campo === 'assessorNome') { va = this.normalize(this.getAssessorNome(a)); vb = this.normalize(this.getAssessorNome(b)); }
      else if (campo === 'bairro') { va = this.normalize(this.getBairro(a)); vb = this.normalize(this.getBairro(b)); }
      else { va = this.normalize(this.displayName(a.nomeCompleto || '')); vb = this.normalize(this.displayName(b.nomeCompleto || '')); }
      if (va < vb) return -1 * mult; if (va > vb) return 1 * mult; return 0;
    });
  }

  private uniqSorted(arr: string[]): string[] {
    return Array.from(new Set(arr.filter(x => !!x && x !== '—')))
      .sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));
  }

  private recalcularCombos() {
    const data = this.aptos();
    this.origensDisponiveis = this.uniqSorted(data.map(c => this.getOrigem(c)));
    this.bairrosDisponiveis = this.uniqSorted(data.map(c => this.getBairro(c)));
    this.cidadesDisponiveis = this.uniqSorted(data.map(c => this.getCidade(c)));
    this.ufsDisponiveis = this.uniqSorted(data.map(c => this.getUF(c)));
    this.assessoresDisponiveis = this.uniqSorted(data.map(c => this.getAssessorNome(c)).filter(a => a !== '(sem assessor)'));
    this.agStatusDisponiveis = this.uniqSorted(data.map(c => this.getAgendaStatus(c)));
  }

  // =================== Grupo ===================
  toggle(id: string) {
    if (this.selecionados.has(id)) {
      // desmarcando
      this.selecionados.delete(id);
      // se era o coordenador, reposiciona coordenador (primeiro da lista, se houver)
      if (this.coordenadorUid === id) {
        const novoCoord = Array.from(this.selecionados)[0] || null;
        this.definirCoordenador(novoCoord);
      }
    } else {
      // marcando
      this.selecionados.add(id);
      // se ainda não há coordenador, primeiro marcado vira coordenador
      if (!this.coordenadorUid) {
        this.definirCoordenador(id);
      }
    }
  }

  get countSelecionados() { return this.selecionados.size; }

  /** Define coordenador e puxa cidade/UF do coordenador */
  private definirCoordenador(id: string | null) {
    this.coordenadorUid = id;

    if (!id) {
      this.coordenadorNome = '';
      return;
    }

    const coord = this.aptos().find(c => c.id === id);
    if (coord) {
      this.coordenadorNome = this.displayName((coord as any)?.nomeCompleto || (coord as any)?.nome || '');

      // sempre sincroniza cidade/UF com o coordenador
      const cidadeCoord = this.getCidade(coord);
      const ufCoord = this.getUF(coord);
      this.cidade = (cidadeCoord && cidadeCoord !== '—') ? cidadeCoord : this.cidade;
      this.uf = (ufCoord && ufCoord !== '—') ? ufCoord : this.uf;
    }
  }

  /** Abre modal de pré-visualização com situação calculada */
  abrirModalCriacao() {
    if (this.countSelecionados === 0) {
      alert('Selecione pelo menos 1 integrante.');
      return;
    }
    const membros = this.getSelecionadosDetalhados();
    const situacao = this.calcularSituacao(membros);

    this.preview = {
      nome: (this.nome || '').trim() || '(Sem nome)',
      coordenadorNome: this.coordenadorNome || '(não definido)',
      coordenadorUid: this.coordenadorUid,
      cidade: this.cidade || '—',
      uf: this.uf || '—',
      capacidadeMin: this.capacidadeMin,
      capacidadeMax: this.capacidadeMax,
      totalSelecionados: this.countSelecionados,
      situacao,
      membros: membros.map(m => ({
        id: m.id,
        nome: this.displayName(m.nomeCompleto || (m as any)?.nome || ''),
        cidade: this.getCidade(m),
        uf: this.getUF(m),
        aprovacao: this.getAprovacaoStatus(m) as any,
      })),
    };

    this.showCreateModal = true;
  }

  fecharModalCriacao() {
    this.showCreateModal = false;
    this.preview = null;
  }

  private getSelecionadosDetalhados(): PreCadastro[] {
    const ids = new Set(this.selecionados);
    return this.aptos().filter(c => ids.has(c.id));
  }

  /** Calcula situação do grupo conforme as regras */
  private calcularSituacao(membros: PreCadastro[]): GrupoSituacao {
    const qtd = membros.length;

    // INCOMPLETO (<3)
    if (qtd < 3) return 'incompleto';

    // INAPTO (>=3 e pelo menos 1 inapto)
    const temInapto = membros.some(m => this.getAprovacaoCode(m) === 'inapto');
    if (temInapto) return 'inapto';

    // APROVADO (>=3 e todos aptos)
    const todosAptos = membros.every(m => this.getAprovacaoCode(m) === 'apto');
    if (todosAptos) return 'aprovado';

    // Se não incompleto, sem inapto, e ainda não todos aptos -> tratamos como incompleto
    return 'incompleto';
  }

  /** Confirma a criação a partir do modal (salva já com situacao e distribuicao vazia) */
  async confirmarCriacaoDoModal() {
    if (!this.preview) return;

    // reforça cidade/UF a partir do coordenador se estiverem vazios
    if (this.coordenadorUid) {
      const coord = this.aptos().find(c => c.id === this.coordenadorUid);
      if (coord) {
        const cidadeCoord = this.getCidade(coord);
        const ufCoord = this.getUF(coord);
        if (!this.cidade || this.cidade === '—') this.cidade = cidadeCoord || '';
        if (!this.uf || this.uf === '—') this.uf = ufCoord || '';
      }
    }

    const membrosIds = Array.from(this.selecionados);
    const user = { uid: 'CURRENT_UID', nome: 'Usuário Logado' }; // troque pelo Auth real
    const situacao = this.preview.situacao;

    try {
      const grupo = await this.svc.criarGrupo({
        nome: this.nome.trim(),
        criadoPorUid: user.uid,
        criadoPorNome: user.nome,
        cidade: this.cidade || null,
        uf: this.uf || null,
        capacidadeMin: this.capacidadeMin,
        capacidadeMax: this.capacidadeMax,
        membrosIds,
        coordenadorUid: this.coordenadorUid,
        coordenadorNome: this.coordenadorNome || null,

        // novos campos
        situacao,
        distribuicao: {
          groupAssessorUid: null,
          groupAssessorNome: null,
          membros: [],
        },
      } as any); // cast temporário caso o service ainda não tenha atualizado o tipo

      // status operacional (não confundir com situacao)
      if (grupo?.id) {
        try {
          const novoStatus: SvcGrupoStatus = (situacao === 'aprovado' ? 'ativo' : 'rascunho') as SvcGrupoStatus;
          await this.svc.definirStatusGrupo(grupo.id, novoStatus);
        } catch (e) {
          console.warn('[criarGrupo] grupo criado, mas falhou ao atualizar status:', e);
          this.successMsg = 'Grupo criado, mas não foi possível atualizar o status agora.';
          setTimeout(() => { this.successMsg = null; }, 5000);
        }
      }


      this.grupoCriadoUrl = grupo?.inviteUrl || null;
      this.selecionados.clear();
      this.definirCoordenador(null);

      const msgOk = `Grupo criado (${situacao.toUpperCase()}) com sucesso!`;
      this.successMsg = msgOk;
      try { window.alert(msgOk); } catch { }
      setTimeout(() => { this.successMsg = null; }, 4000);
    } catch (e) {
      console.error('[confirmarCriacaoDoModal] erro:', e);
      alert('Falha ao criar o grupo. Tente novamente.');
    } finally {
      this.fecharModalCriacao();
    }
  }

  /** (mantido para compat) criação direta sem modal — não está sendo usado no HTML atual */
  async criarGrupo() {
    if (!this.nome.trim()) { alert('Dê um nome ao grupo.'); return; }
    if (this.countSelecionados === 0) { alert('Selecione pelo menos 1 integrante.'); return; }
    if (this.countSelecionados > this.capacidadeMax) {
      alert(`O grupo pode ter no máximo ${this.capacidadeMax} integrantes.`);
      return;
    }

    const membrosIds = Array.from(this.selecionados);
    const user = { uid: 'CURRENT_UID', nome: 'Usuário Logado' }; // troque pelo Auth real
    const statusGrupo: 'incompleto' | 'completo' =
      (this.countSelecionados < this.capacidadeMin) ? 'incompleto' : 'completo';

    // 1) Criar grupo (bloco independente)
    let grupo: { id?: string; inviteUrl?: string } | null = null;
    try {
      grupo = await this.svc.criarGrupo({
        nome: this.nome.trim(),
        criadoPorUid: user.uid,
        criadoPorNome: user.nome,
        cidade: this.cidade || null,
        uf: this.uf || null,
        capacidadeMin: this.capacidadeMin,
        capacidadeMax: this.capacidadeMax,
        membrosIds,
        coordenadorUid: this.coordenadorUid,
        coordenadorNome: this.coordenadorNome || null,
      });
    } catch (e) {
      console.error('[criarGrupo] falha na criação:', e);
      alert('Falha ao criar o grupo. Tente novamente.');
      return; // sai aqui se realmente não criou
    }

    // 2) Atualizar status (NÃO bloqueante)
    if (grupo?.id) {
      try {
        const novoStatus: SvcGrupoStatus = (statusGrupo === 'completo' ? 'ativo' : 'rascunho') as SvcGrupoStatus;
        await this.svc.definirStatusGrupo(grupo.id, novoStatus);
      } catch (e) {
        console.warn('[criarGrupo] grupo criado, mas falhou ao atualizar status:', e);
        this.successMsg = 'Grupo criado com sucesso, porém não foi possível atualizar o status agora.';
        setTimeout(() => { this.successMsg = null; }, 5000);
      }
    }


    // 3) Finalização de sucesso
    this.grupoCriadoUrl = grupo?.inviteUrl || null;
    this.selecionados.clear();

    const msgOk = `Grupo criado com sucesso${statusGrupo === 'incompleto' ? ' (status: Incompleto)' : ''}!`;
    this.successMsg = msgOk;
    try { window.alert(msgOk); } catch { }
    setTimeout(() => { this.successMsg = null; }, 4000);
  }

  // =================== Helpers visuais (idênticos à listagem) ===================
  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  displayName(raw?: string): string {
    const s = (raw || '').trim(); if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keep = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keep.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }
  maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11) return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }
  private asDateFlexible(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof v.toDate === 'function') { try { return v.toDate(); } catch { } }
    if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      return new Date(v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6));
    }
    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  toBRDate(value: any): string {
    const d = this.asDateFlexible(value); if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  toBRTimeFromDate(d: Date): string {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  getAssessorNome(c: PreCadastro): string {
    const nome = (c.createdByNome || '').trim();
    if (nome) return this.displayName(nome);
    if (c.createdByUid) return `UID: ${c.createdByUid.slice(0, 6)}…`;
    return '(sem assessor)';
  }
  getOrigem(c: PreCadastro): string {
    const o = (c as any)?.origem ?? (c as any)?.origemNome ?? '';
    return (o || '').toString().trim() || '—';
  }
  getBairro(c: PreCadastro): string {
    const b = (c as any)?.bairro ?? (c as any)?.enderecoBairro ?? (c as any)?.addressBairro ?? '';
    return (b || '').toString().trim() || '—';
  }
  getCidade(c: PreCadastro): string {
    const v = (c as any)?.cidade ?? (c as any)?.enderecoCidade ?? '';
    return (v || '').toString().trim() || '—';
  }
  getUF(c: PreCadastro): string {
    const v = (c as any)?.uf ?? (c as any)?.enderecoUF ?? '';
    return (v || '').toString().trim().toUpperCase() || '—';
  }
  private getAprovacaoCode(c: any): 'apto' | 'inapto' | 'pendente' | 'desconhecido' {
    const cand = c?.aprovacao?.status ?? c?.aprovacaoStatus ?? '';
    const n = this.normalize((cand || '').toString());
    if (!n) return 'desconhecido';
    if (/\binapto\b/.test(n) || /reprov/.test(n) || /neg/.test(n)) return 'inapto';
    if (/\bapto\b/.test(n) || /aprov/.test(n)) return 'apto';
    if (/pend/.test(n) || /analise/.test(n) || /nao_verificado|não_verificado/.test(n)) return 'pendente';
    return 'desconhecido';
  }
  getAprovacaoStatus(c: any): string {
    const code = this.getAprovacaoCode(c);
    if (code === 'apto') return 'Apto';
    if (code === 'inapto') return 'Inapto';
    if (code === 'pendente') return 'Pendente';
    return '—';
  }
  isAgendado(c: any): boolean {
    const ag = c?.agendamento;
    const temNovo = ag?.dataHora || ag?.status;
    const temLegado =
      c?.agendado === true ||
      ag?.data ||
      c?.agendamentoEm ||
      c?.agendaData ||
      ag?.hora ||
      c?.agendaHora ||
      ag?.status ||
      c?.agendamentoStatus;
    return !!(temNovo || temLegado);
  }
  private getAgendaDateTime(c: any): Date | null {
    const ag = c?.agendamento;
    if (ag?.dataHora) return this.asDateFlexible(ag.dataHora);
    const dataBruta = ag?.data ?? c?.agendamentoEm ?? c?.agendaData ?? null;
    const d = this.asDateFlexible(dataBruta);
    if (!d) return null;
    const horaStr = ag?.hora ?? c?.agendaHora ?? null;
    if (typeof horaStr === 'string' && /^\d{1,2}:\d{2}$/.test(horaStr)) {
      const [h, m] = horaStr.split(':').map(Number);
      d.setHours(Math.min(23, Math.max(0, h || 0)), Math.min(59, Math.max(0, m || 0)), 0, 0);
    }
    return d;
  }
  private getAgendaStatus(c: any): string {
    const ag = c?.agendamento;
    return (ag?.status ?? c?.agendamentoStatus ?? '').toString().trim();
  }
  getAgendamentoResumo(c: any): string {
    if (!this.isAgendado(c)) return '—';
    const dt = this.getAgendaDateTime(c);
    const status = this.getAgendaStatus(c);
    if (dt) {
      const data = this.toBRDate(dt);
      const hora = this.toBRTimeFromDate(dt);
      return [[data, hora].filter(Boolean).join(' '), status].filter(Boolean).join(' · ');
    }
    return ['Agendado', status].filter(Boolean).join(' · ');
  }

  // utilidade pra *ngFor
  trackById(_idx: number, item: any) { return item.id; }

  // copiar link
  copyLink() {
    if (!this.grupoCriadoUrl) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(this.grupoCriadoUrl)
        .then(() => this.showToast('Link copiado!'))
        .catch(() => this.fallbackCopy(this.grupoCriadoUrl!));
    } else {
      this.fallbackCopy(this.grupoCriadoUrl!);
    }
  }
  private fallbackCopy(text: string) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      this.showToast(ok ? 'Link copiado!' : 'Copie manualmente o link.');
    } catch { this.showToast('Copie manualmente o link.'); }
  }
  private showToast(msg: string) {
    this.toastMsg = msg;
    setTimeout(() => (this.toastMsg = null), 2000);
  }
}
