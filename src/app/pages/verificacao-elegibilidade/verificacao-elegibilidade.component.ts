import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../shared/header/header.component';

import {
  Firestore, collection, query, where, updateDoc, doc,
  serverTimestamp, getDocs, getDoc
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { PreCadastro } from '../../models/pre-cadastro.model';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  papel: Papel;
};

@Component({
  selector: 'app-verificacao-elegibilidade',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './verificacao-elegibilidade.component.html',
})
export class VerificacaoElegibilidadeComponent implements OnInit, OnDestroy {

  private fs = inject(Firestore);
  private auth = inject(Auth);

  loading = signal(false);
  preCadastros = signal<PreCadastro[]>([]);
  currentUser = signal<{ uid: string; nome?: string; papel?: string } | null>(null);

  private nomePorUid = new Map<string, string>();
  private nomesSignal = signal<Record<string, string>>({});

  // ===== Filtros =====
  filtroElegivel = signal<'todos' | 'nao_verificado' | 'sim' | 'nao'>('todos');
  filtroDataDe = signal<string>('');
  filtroDataAte = signal<string>('');
  filtroCidade = signal<string>('');
  filtroUf = signal<string>('');
  filtroBairro = signal<string>('');
  filtroCpf = signal<string>('');

  // ===== Paginação =====
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

  // ===== Modal Não Elegível =====
  naoElegivelAberto = signal(false);
  private naoElegivelId = signal<string | null>(null);

  constructor() {
    onAuthStateChanged(this.auth, (u) => {
      if (!u) {
        this.currentUser.set(null);
        this.preCadastros.set([]);
        this.loading.set(false);
        return;
      }
      this.currentUser.set({ uid: u.uid, nome: u.displayName ?? undefined });
      this.carregarTudo();
    });
  }

  ngOnInit(): void { }
  ngOnDestroy(): void { }

  // ===== Handlers de filtro =====
  onFiltroElegivelChange(v: string) { this.filtroElegivel.set(v as any); this.currentPage = 1; }
  onFiltroDataDeChange(v: string) { this.filtroDataDe.set(v); this.currentPage = 1; }
  onFiltroDataAteChange(v: string) { this.filtroDataAte.set(v); this.currentPage = 1; }
  onFiltroCidadeChange(v: string) { this.filtroCidade.set(v); this.currentPage = 1; }
  onFiltroUfChange(v: string) { this.filtroUf.set(v); this.currentPage = 1; }
  onFiltroBairroChange(v: string) { this.filtroBairro.set(v); this.currentPage = 1; }
  onFiltroCpfChange(v: string) { this.filtroCpf.set(v.replace(/\D/g, '')); this.currentPage = 1; }

  // ===== Carregar dados (apenas aptos) =====
  async carregarTudo(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const [snap1, snap2] = await Promise.all([
        getDocs(query(collection(this.fs, 'pre_cadastros'), where('aprovacao.status', '==', 'apto'))),
        getDocs(query(collection(this.fs, 'pre-cadastros'), where('aprovacao.status', '==', 'apto'))),
      ]);

      const acc = new Map<string, any>();
      const needNames = new Set<string>();

      const processSnap = (snap: any, colName: string) => {
        snap.forEach((d: any) => {
          const raw = d.data() as any;
          const item = { id: d.id, ...raw, __col: colName };
          const prev = acc.get(item.id);
          acc.set(item.id, prev ? { ...prev, ...item } : item);
          const created = item?.createdByUid as string | undefined;
          if (created) needNames.add(created);
        });
      };

      processSnap(snap1, 'pre_cadastros');
      processSnap(snap2, 'pre-cadastros');

      const arr = Array.from(acc.values());
      this.preCadastros.set(arr);
      await this.preloadColabNames(Array.from(needNames));
    } catch (e) {
      console.error('[ElegibilidadeVerif] erro ao carregar:', e);
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Computed: filtrados =====
  filtrados = computed(() => {
    const list = [...this.preCadastros()];
    const f = this.filtroElegivel();
    const de = this.filtroDataDe();
    const ate = this.filtroDataAte();
    const cidade = this.filtroCidade().toLowerCase();
    const uf = this.filtroUf().toLowerCase();
    const bairro = this.filtroBairro().toLowerCase();
    const cpf = this.filtroCpf().replace(/\D/g, '');

    let base = list;

    if (f !== 'todos') {
      base = base.filter(i => (i.elegivel?.status ?? 'nao_verificado') === f);
    }

    if (cidade) base = base.filter(i => ((i as any).cidade || '').toLowerCase().includes(cidade));
    if (uf) base = base.filter(i => ((i as any).uf || '').toLowerCase().includes(uf));
    if (bairro) base = base.filter(i => ((i as any).bairro || '').toLowerCase().includes(bairro));
    if (cpf) base = base.filter(i => ((i as any).cpf || '').replace(/\D/g, '').includes(cpf));

    const dtDe = de ? new Date(de + 'T00:00:00') : null;
    const dtAte = ate ? new Date(ate + 'T23:59:59') : null;
    if (dtDe || dtAte) {
      base = base.filter(i => {
        const d = this.aprovacaoEmOf(i);
        if (!d) return false;
        if (dtDe && d < dtDe) return false;
        if (dtAte && d > dtAte) return false;
        return true;
      });
    }

    return base.sort((a, b) =>
      (this.aprovacaoEmOf(b)?.getTime() ?? 0) - (this.aprovacaoEmOf(a)?.getTime() ?? 0)
    );
  });

  // ===== Ações =====
  async marcarElegivel(item: PreCadastro) {
    const cu = this.currentUser();
    if (!cu) return;

    let porNome = cu.nome ?? 'Analista';
    try {
      const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', cu.uid)));
      const hit = snap.docs[0]?.data() as any;
      porNome = hit?.nome || porNome;
      if (porNome) this.setNome(cu.uid, porNome);
    } catch { }

    const payload: any = {
      'elegivel.status': 'sim',
      'elegivel.porUid': cu.uid,
      'elegivel.porNome': porNome,
      'elegivel.em': serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, elegivel: { status: 'sim', porNome, porUid: cu.uid } }
        : it
      )
    );
  }

  abrirModalNaoElegivel(item: PreCadastro) {
    this.naoElegivelId.set(item.id);
    this.naoElegivelAberto.set(true);
  }

  fecharModalNaoElegivel() {
    this.naoElegivelAberto.set(false);
    this.naoElegivelId.set(null);
  }

  async confirmarNaoElegivel() {
    const id = this.naoElegivelId();
    const cu = this.currentUser();
    if (!id || !cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Analista';

    const payload: any = {
      'elegivel.status': 'nao',
      'elegivel.porUid': cu.uid,
      'elegivel.porNome': porNome,
      'elegivel.em': serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === id
        ? { ...it as any, elegivel: { status: 'nao', porNome, porUid: cu.uid } }
        : it
      )
    );

    this.fecharModalNaoElegivel();
  }

  // ===== Helpers =====
  elegivelStatus(item: PreCadastro): 'nao_verificado' | 'sim' | 'nao' {
    return (item.elegivel?.status ?? 'nao_verificado') as any;
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

  private aprovacaoEmOf(it: any): Date | null {
    const raw = it?.aprovacao?.em;
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') return new Date(raw);
    return null;
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
