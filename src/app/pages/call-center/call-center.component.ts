import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../shared/header/header.component';

import {
  Firestore, collection, query, where, updateDoc, doc,
  serverTimestamp, getDocs, getDoc, setDoc
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { PreCadastro } from '../../models/pre-cadastro.model';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';

type Assessor = { id: string; uid?: string; nome: string; papel: Papel };

@Component({
  selector: 'app-call-center',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './call-center.component.html',
})
export class CallCenterComponent implements OnInit, OnDestroy {

  private fs = inject(Firestore);
  private auth = inject(Auth);

  loading = signal(false);
  preCadastros = signal<PreCadastro[]>([]);
  assessores = signal<Assessor[]>([]);
  currentUser = signal<{ uid: string; nome?: string; papel?: string } | null>(null);

  private nomePorUid = new Map<string, string>();
  private nomesSignal = signal<Record<string, string>>({});

  // ===== Abas =====
  abaAtiva = signal<'geral' | 'meus' | 'agenda'>('geral');

  // ===== Filtros (aba geral) =====
  filtroAtendimento = signal<'todos' | 'nao_atendido' | 'em_atendimento' | 'finalizado'>('todos');
  filtroCidade = signal<string>('');
  filtroUf = signal<string>('');
  filtroBairro = signal<string>('');
  filtroCpf = signal<string>('');

  // ===== Paginação aba geral =====
  pageSize = 20;
  currentPage = 1;
  get totalItems(): number { return this.filtrados().length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get pageStart(): number { return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0; }
  get pageEnd(): number { return Math.min(this.pageStart + this.pageSize, this.totalItems); }
  pageItems(): PreCadastro[] { return this.filtrados().slice(this.pageStart, this.pageEnd); }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  prevPage() { if (this.currentPage > 1) this.currentPage--; }
  onPageSizeChange(val: number) { this.pageSize = Number(val) || 20; this.currentPage = 1; }

  // ===== Paginação aba meus =====
  meusPageSize = 20;
  meusCurrentPage = 1;
  get meusTotalItems(): number { return this.meusFiltrado().length; }
  get meusTotalPages(): number { return Math.max(1, Math.ceil(this.meusTotalItems / this.meusPageSize)); }
  get meusPageStart(): number { return this.meusTotalItems ? (this.meusCurrentPage - 1) * this.meusPageSize : 0; }
  get meusPageEnd(): number { return Math.min(this.meusPageStart + this.meusPageSize, this.meusTotalItems); }
  meusPageItems(): PreCadastro[] { return this.meusFiltrado().slice(this.meusPageStart, this.meusPageEnd); }
  meusNextPage() { if (this.meusCurrentPage < this.meusTotalPages) this.meusCurrentPage++; }
  meusPrevPage() { if (this.meusCurrentPage > 1) this.meusCurrentPage--; }

  // ===== Modal: Finalizar =====
  finalizarAberto = signal(false);
  private finalizarId = signal<string | null>(null);

  // ===== Aba Agenda =====
  filtroAssessorAgenda = signal<string>('');
  filtroPeriodoAgenda = signal<'todos' | 'semana' | 'mes'>('todos');

  agendamentosDoAssessor = computed(() => {
    const uid = this.filtroAssessorAgenda();
    const periodo = this.filtroPeriodoAgenda();

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let inicioSemana: Date | null = null;
    let fimSemana: Date | null = null;
    let inicioMes: Date | null = null;
    let fimMes: Date | null = null;

    if (periodo === 'semana') {
      const dow = hoje.getDay(); // 0=dom
      inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - dow);
      fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
    } else if (periodo === 'mes') {
      inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    }

    return this.preCadastros()
      .filter(i => {
        const data: string = (i as any).agendamentoData;
        if (!data) return false;
        if (uid) {
          const vinculado =
            (i as any)?.encaminhamento?.assessorUid === uid ||
            (i as any)?.createdByUid === uid ||
            (i as any)?.alocadoParaUid === uid;
          if (!vinculado) return false;
        }

        if (periodo !== 'todos') {
          // data está em formato YYYY-MM-DD
          const [y, m, d] = data.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          if (periodo === 'semana') return dt >= inicioSemana! && dt <= fimSemana!;
          if (periodo === 'mes')   return dt >= inicioMes!    && dt <= fimMes!;
        }
        return true;
      })
      .sort((a, b) => {
        const da = (a as any).agendamentoData ?? '';
        const db = (b as any).agendamentoData ?? '';
        if (da < db) return -1;
        if (da > db) return 1;
        const ha = (a as any).agendamentoHora ?? '';
        const hb = (b as any).agendamentoHora ?? '';
        return ha.localeCompare(hb);
      });
  });

  // ===== Modal: Encaminhar para assessor =====
  encaminharAberto = signal(false);
  private encaminharItem = signal<PreCadastro | null>(null);
  assessorSelecionado = signal<string>('');

  agendamentosAssessorEncaminhar = computed(() => {
    const uid = this.assessorSelecionado();
    if (!uid) return [];
    return this.preCadastros()
      .filter(i => {
        if (!(i as any).agendamentoData) return false;
        return (i as any)?.encaminhamento?.assessorUid === uid ||
               (i as any)?.createdByUid === uid ||
               (i as any)?.alocadoParaUid === uid;
      })
      .sort((a, b) => {
        const da = (a as any).agendamentoData ?? '';
        const db = (b as any).agendamentoData ?? '';
        if (da < db) return -1;
        if (da > db) return 1;
        return ((a as any).agendamentoHora ?? '').localeCompare((b as any).agendamentoHora ?? '');
      });
  });

  // ===== Modal: Agendamento =====
  agendamentoAberto = signal(false);
  private agendamentoItem = signal<PreCadastro | null>(null);
  agendamentoData = signal<string>('');
  agendamentoHora = signal<string>('');

  // ===== Modal: Editar cliente =====
  editarAberto = signal(false);
  private editarItem = signal<PreCadastro | null>(null);
  editForm = signal<{
    nomeCompleto: string;
    telefone: string;
    email: string;
    bairro: string;
    cidade: string;
    uf: string;
    modalidade: string;
    origem: string;
  }>({ nomeCompleto: '', telefone: '', email: '', bairro: '', cidade: '', uf: '', modalidade: '', origem: '' });
  salvandoEdicao = signal(false);

  constructor() {
    onAuthStateChanged(this.auth, async (u) => {
      if (!u) {
        this.currentUser.set(null);
        this.preCadastros.set([]);
        this.loading.set(false);
        return;
      }

      let papel: string | undefined;
      let nome: string | undefined;
      try {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', u.uid)));
        const hit = snap.docs[0]?.data() as any;
        papel = hit?.papel;
        nome = hit?.nome;
        if (nome) this.setNome(u.uid, nome);
      } catch { }

      this.currentUser.set({ uid: u.uid, nome: nome ?? u.displayName ?? undefined, papel });
      this.carregarTudo();
    });
  }

  ngOnInit(): void { }
  ngOnDestroy(): void { }

  // ===== Handlers de filtro =====
  onFiltroAtendimentoChange(v: string) { this.filtroAtendimento.set(v as any); this.currentPage = 1; }
  onFiltroCidadeChange(v: string) { this.filtroCidade.set(v); this.currentPage = 1; }
  onFiltroUfChange(v: string) { this.filtroUf.set(v); this.currentPage = 1; }
  onFiltroBairroChange(v: string) { this.filtroBairro.set(v); this.currentPage = 1; }
  onFiltroCpfChange(v: string) { this.filtroCpf.set(v.replace(/\D/g, '')); this.currentPage = 1; }

  // ===== Carregar dados =====
  async carregarTudo(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const [snapAss, snap1, snap2] = await Promise.all([
        getDocs(query(collection(this.fs, 'colaboradores'), where('papel', '==', 'assessor'), where('status', '==', 'ativo'))),
        getDocs(query(collection(this.fs, 'pre_cadastros'), where('elegivel.status', '==', 'sim'))),
        getDocs(query(collection(this.fs, 'pre-cadastros'), where('elegivel.status', '==', 'sim'))),
      ]);

      // Assessores
      const assRows = snapAss.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Assessor));
      assRows.forEach(a => { if (!a.uid) a.uid = a.id; this.setNome(a.uid!, a.nome); });
      assRows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
      this.assessores.set(assRows);

      // Pré-cadastros elegíveis
      const acc = new Map<string, any>();
      const needNames = new Set<string>();

      const processSnap = (snap: any, colName: string) => {
        snap.forEach((d: any) => {
          const raw = d.data() as any;
          const item = { id: d.id, ...raw, __col: colName };
          const prev = acc.get(item.id);
          acc.set(item.id, prev ? { ...prev, ...item } : item);
          if (item?.createdByUid) needNames.add(item.createdByUid);
          if (item?.atendimento?.porUid) needNames.add(item.atendimento.porUid);
          if (item?.encaminhamento?.assessorUid) needNames.add(item.encaminhamento.assessorUid);
        });
      };

      processSnap(snap1, 'pre_cadastros');
      processSnap(snap2, 'pre-cadastros');

      const arr = Array.from(acc.values());
      this.preCadastros.set(arr);
      await this.preloadColabNames(Array.from(needNames));
    } catch (e) {
      console.error('[CallCenter] erro ao carregar:', e);
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Computed: filtrados (aba geral) =====
  filtrados = computed(() => {
    const f = this.filtroAtendimento();
    const cidade = this.filtroCidade().toLowerCase();
    const uf = this.filtroUf().toLowerCase();
    const bairro = this.filtroBairro().toLowerCase();
    const cpf = this.filtroCpf().replace(/\D/g, '');

    let base = [...this.preCadastros()];

    if (f !== 'todos') base = base.filter(i => (i.atendimento?.status ?? 'nao_atendido') === f);
    if (cidade) base = base.filter(i => ((i as any).cidade || '').toLowerCase().includes(cidade));
    if (uf) base = base.filter(i => ((i as any).uf || '').toLowerCase().includes(uf));
    if (bairro) base = base.filter(i => ((i as any).bairro || '').toLowerCase().includes(bairro));
    if (cpf) base = base.filter(i => ((i as any).cpf || '').replace(/\D/g, '').includes(cpf));

    const order: Record<string, number> = { em_atendimento: 0, nao_atendido: 1, finalizado: 2 };
    return base.sort((a, b) => {
      const oa = order[a.atendimento?.status ?? 'nao_atendido'] ?? 1;
      const ob = order[b.atendimento?.status ?? 'nao_atendido'] ?? 1;
      return oa - ob;
    });
  });

  // ===== Computed: meus atendimentos =====
  meusFiltrado = computed(() => {
    const uid = this.currentUser()?.uid;
    if (!uid) return [];

    return this.preCadastros()
      .filter(i => {
        const st = i.atendimento?.status ?? 'nao_atendido';
        const porUid = i.atendimento?.porUid;
        return (st === 'em_atendimento' || st === 'finalizado') && porUid === uid;
      })
      .sort((a, b) => {
        if (a.atendimento?.status === 'em_atendimento' && b.atendimento?.status !== 'em_atendimento') return -1;
        if (b.atendimento?.status === 'em_atendimento' && a.atendimento?.status !== 'em_atendimento') return 1;
        return 0;
      });
  });

  // ===== Verifica permissão de ação =====
  isOperacional(): boolean {
    const papel = this.currentUser()?.papel;
    return papel === 'operacional' || papel === 'admin';
  }

  // ===== Ação: Iniciar atendimento =====
  async iniciarAtendimento(item: PreCadastro) {
    const cu = this.currentUser();
    if (!cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Operacional';

    const payload: any = {
      'atendimento.status': 'em_atendimento',
      'atendimento.porUid': cu.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, atendimento: { status: 'em_atendimento', porNome, porUid: cu.uid } }
        : it
      )
    );
  }

  // ===== Ação: Liberar atendimento =====
  async liberarAtendimento(item: PreCadastro) {
    const payload: any = {
      'atendimento.status': 'nao_atendido',
      'atendimento.porUid': null,
      'atendimento.porNome': null,
      'atendimento.em': null,
      'atendimento.observacao': null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, atendimento: { status: 'nao_atendido', porNome: null, porUid: null } }
        : it
      )
    );
  }

  // ===== Modal: Finalizar =====
  abrirModalFinalizar(item: PreCadastro) {
    this.finalizarId.set(item.id);
    this.finalizarAberto.set(true);
  }

  fecharModalFinalizar() {
    this.finalizarAberto.set(false);
    this.finalizarId.set(null);
  }

  async confirmarFinalizar(obs: string) {
    const id = this.finalizarId();
    const cu = this.currentUser();
    if (!id || !cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Operacional';

    const payload: any = {
      'atendimento.status': 'finalizado',
      'atendimento.porUid': cu.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': obs.trim() || null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === id
        ? { ...it as any, atendimento: { status: 'finalizado', porNome, porUid: cu.uid, observacao: obs.trim() || null } }
        : it
      )
    );

    this.fecharModalFinalizar();
  }

  // ===== Modal: Encaminhar para assessor =====
  abrirModalEncaminhar(item: PreCadastro) {
    this.encaminharItem.set(item);
    const jaVinculado = (item as any)?.encaminhamento?.assessorUid ?? '';
    this.assessorSelecionado.set(jaVinculado);
    this.encaminharAberto.set(true);
  }

  fecharModalEncaminhar() {
    this.encaminharAberto.set(false);
    this.encaminharItem.set(null);
    this.assessorSelecionado.set('');
  }

  async confirmarEncaminhar() {
    const item = this.encaminharItem();
    const chosen = this.assessorSelecionado();
    const cu = this.currentUser();
    if (!item || !chosen || !cu) return;

    const ass = this.assessores().find(a => (a.uid || a.id) === chosen);
    const realUid = ass?.uid || ass?.id || chosen;
    const assessorNome = ass?.nome || this.nomeDoAutor(realUid) || null;
    if (assessorNome) this.setNome(realUid, assessorNome);

    const criadorUid = (item as any)?.createdByUid ?? null;
    const visivelParaUids = Array.from(new Set([realUid, cu.uid, criadorUid].filter(Boolean))) as string[];

    const payload: any = {
      encaminhamento: {
        assessorUid: realUid,
        assessorId: realUid,
        assessorNome,
        em: serverTimestamp(),
      },
      caixaAtual: 'assessor',
      caixaUid: realUid,
      destinatarioTipo: 'assessor',
      destinatarioUid: realUid,
      alocadoParaUid: realUid,
      alocadoParaNome: assessorNome,
      visivelParaUids,
      analistaId: cu.uid,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      setDoc(doc(this.fs, 'pre_cadastros', item.id), payload, { merge: true }),
    ]);

    await setDoc(
      doc(this.fs, `inboxes_assessores/${realUid}/itens/${item.id}`),
      {
        preCadastroId: item.id,
        path: `pre_cadastros/${item.id}`,
        nomeCompleto: (item as any)?.nomeCompleto ?? null,
        cpf: (item as any)?.cpf ?? null,
        em: serverTimestamp(),
      },
      { merge: true }
    );

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, encaminhamento: { assessorUid: realUid, assessorNome, em: null }, caixaAtual: 'assessor' }
        : it
      )
    );

    this.fecharModalEncaminhar();
  }

  // ===== Modal: Agendamento =====
  abrirModalAgendamento(item: PreCadastro) {
    this.agendamentoItem.set(item);
    this.agendamentoData.set((item as any)?.agendamentoData ?? '');
    this.agendamentoHora.set((item as any)?.agendamentoHora ?? '');
    this.agendamentoAberto.set(true);
  }

  fecharModalAgendamento() {
    this.agendamentoAberto.set(false);
    this.agendamentoItem.set(null);
    this.agendamentoData.set('');
    this.agendamentoHora.set('');
  }

  async confirmarAgendamento() {
    const item = this.agendamentoItem();
    const data = this.agendamentoData().trim();
    const hora = this.agendamentoHora().trim();
    if (!item || !data) return;

    const payload: any = {
      agendamentoData: data,
      agendamentoHora: hora || null,
      agendamentoStatus: 'agendado',
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, agendamentoData: data, agendamentoHora: hora || null, agendamentoStatus: 'agendado' }
        : it
      )
    );

    this.fecharModalAgendamento();
  }

  // ===== Modal: Editar cliente =====
  abrirModalEditar(item: PreCadastro) {
    this.editarItem.set(item);
    this.editForm.set({
      nomeCompleto: item.nomeCompleto ?? '',
      telefone: item.telefone ?? '',
      email: item.email ?? '',
      bairro: item.bairro ?? '',
      cidade: (item as any).cidade ?? '',
      uf: (item as any).uf ?? '',
      modalidade: item.modalidade ?? '',
      origem: item.origem ?? '',
    });
    this.editarAberto.set(true);
  }

  fecharModalEditar() {
    this.editarAberto.set(false);
    this.editarItem.set(null);
    this.salvandoEdicao.set(false);
  }

  async confirmarEdicao() {
    const item = this.editarItem();
    if (!item) return;

    this.salvandoEdicao.set(true);
    try {
      const f = this.editForm();
      const payload: any = {
        nomeCompleto: f.nomeCompleto.trim(),
        telefone: f.telefone.trim(),
        email: f.email.trim(),
        bairro: f.bairro.trim(),
        cidade: f.cidade.trim(),
        uf: f.uf.trim().toUpperCase(),
        modalidade: f.modalidade.trim(),
        origem: f.origem.trim(),
        atualizadoEm: serverTimestamp(),
      };

      await Promise.all([
        updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
        updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
      ]);

      this.preCadastros.update(list =>
        list.map(it => it.id === item.id ? { ...it as any, ...payload } : it)
      );

      this.fecharModalEditar();
    } catch (e) {
      console.error('[CallCenter] erro ao salvar edição:', e);
    } finally {
      this.salvandoEdicao.set(false);
    }
  }

  updateEditForm(field: string, value: string) {
    this.editForm.update(f => ({ ...f, [field]: value }));
  }

  // ===== Helpers =====
  atendimentoStatus(item: PreCadastro): 'nao_atendido' | 'em_atendimento' | 'finalizado' {
    return (item.atendimento?.status ?? 'nao_atendido') as any;
  }

  contarPorStatus(status: string): number {
    return this.preCadastros().filter(i => (i.atendimento?.status ?? 'nao_atendido') === status).length;
  }

  nomeDoAutor(uid?: string | null): string {
    if (!uid) return '';
    return this.nomesSignal()[uid] || this.nomePorUid.get(uid) || uid;
  }

  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  private setNome(uid: string, nome?: string) {
    if (!uid || !nome) return;
    this.nomePorUid.set(uid, nome);
    const curr = this.nomesSignal();
    if (curr[uid] !== nome) this.nomesSignal.set({ ...curr, [uid]: nome });
  }

  private async preloadColabNames(uids: string[]) {
    const missing = uids.filter(u => u && !this.nomePorUid.has(u));
    if (!missing.length) return;

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));

    for (const c of chunks) {
      try {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', 'in', c)));
        snap.docs.forEach(d => this.setNome((d.data() as any)?.uid || d.id, (d.data() as any)?.nome));
      } catch { }
    }

    const still = missing.filter(u => !this.nomePorUid.has(u));
    for (const uid of still) {
      try {
        const s = await getDoc(doc(this.fs, 'colaboradores', uid));
        if (s.exists()) this.setNome(uid, (s.data() as any)?.nome || uid);
      } catch { }
    }
  }
}
