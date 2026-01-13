import { Component, OnInit, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc, getDoc, collectionData } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

// Firebase modular (para excluir)
import { deleteDoc as fsDeleteDoc, doc as fsDoc } from 'firebase/firestore';

declare const bootstrap: any;

type Papel = 'admin' | 'supervisor' | 'coordenador' | 'rh' | 'assessor' | 'desconhecido';

type RowVM = {
  // base do cadastro
  id?: string;
  nomeCompleto?: string;
  nome?: string;
  cpf?: string;
  telefone?: string;
  contato?: string;
  email?: string;
  endereco?: string;
  enderecoCompleto?: string;
  dataPreenchimento?: any; // Timestamp | ISO | Date | number
  createdAt?: any;         // fallback, se existir

  // autoria
  createdByUid?: string;
  createdByNome?: string;

  // VM
  data: Date | null;
  nomeExibicao: string;
};

@Component({
  selector: 'app-relatorio-cadastros',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './relatorio-cadastros.component.html',
  styleUrls: ['./relatorio-cadastros.component.css'],
})
export class RelatorioCadastrosComponent implements OnInit {
  public auth = inject(Auth);
  private afs = inject(Firestore);
  private router = inject(Router);

  loading = signal(false);
  erro = signal<string | null>(null);

  papel: Papel = 'desconhecido';
  rows = signal<RowVM[]>([]);

  // Modal (cards)
  @ViewChild('cadastrosModal', { static: false }) cadastrosModalRef?: ElementRef<HTMLDivElement>;
  private cadastrosModal?: any;
  selectedAssessorUid: string | null = null;
  selectedAssessorNome = '';
  selectedCadastros: RowVM[] = [];

  async ngOnInit() {
    this.loading.set(true);
    this.erro.set(null);

    try {
      await this.resolvePapel();

      // Carrega TODOS os cadastros da coleção 'clientes'
      const ref = collection(this.afs, 'clientes');
      const raw = await firstValueFrom(collectionData(ref, { idField: 'id' }) as any);

      const mapped: RowVM[] = (raw as any[]).map((r) => {
        const data = this.pickDate(r);
        return {
          ...r,
          data,
          nomeExibicao: this.displayName(r?.nomeCompleto ?? r?.nome ?? ''),
        } as RowVM;
      });

      this.rows.set(mapped);
    } catch (e: any) {
      console.error('[Relatório Cadastros] erro:', e);
      this.erro.set(e?.message || 'Erro ao carregar relatório.');
    } finally {
      this.loading.set(false);
    }
  }

  // ====== Papel do usuário ======
  private async resolvePapel() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      this.papel = 'desconhecido';
      return;
    }
    const ref = doc(collection(this.afs, 'colaboradores'), uid);
    const snap = await getDoc(ref);
    const raw = (snap.data() as any)?.papel;
    const normalized = (typeof raw === 'string' ? raw : '').trim().toLowerCase();

    const allow: Papel[] = ['admin', 'supervisor', 'coordenador', 'rh', 'assessor'];
    this.papel = (allow.includes(normalized as Papel) ? normalized : 'assessor') as Papel;
    console.log('[Relatório Cadastros] papel detectado:', raw, '→', this.papel);
  }

  // ====== Helpers ======
  private toDate(x: unknown): Date | null {
    if (!x) return null;

    // Firestore Timestamp
    if (typeof (x as any)?.seconds === 'number') {
      const t = x as any;
      return new Date(t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6));
    }

    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);

    if (typeof x === 'string') {
      // tenta ISO ou Date parseável
      const d = new Date(x);
      if (!isNaN(d.getTime())) return d;
      // tenta dd/MM/yyyy simples
      const m = x.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const dd = +m[1], mm = +m[2], yyyy = +m[3];
        const d2 = new Date(yyyy, mm - 1, dd);
        if (!isNaN(d2.getTime())) return d2;
      }
    }
    return null;
  }

  private pickDate(r: any): Date | null {
    return this.toDate(r?.dataPreenchimento ?? r?.createdAt ?? null);
  }

  private displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keepLower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts
      .map((p, i) => (i > 0 && keepLower.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  }

  // ====== Visões ======
  meus(): RowVM[] {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return [];
    return this.rows().filter((r) => r.createdByUid === uid);
  }

  porAssessor(): Array<{ uid: string; assessor: string; total: number }> {
    const map = new Map<string, { uid: string; assessor: string; total: number }>();
    for (const r of this.rows()) {
      const uid = r.createdByUid ?? 'sem-uid';
      const nomeAssessor = this.displayName(r.createdByNome || '') || (r.createdByUid ? `UID: ${r.createdByUid.slice(0,6)}…` : 'Assessor');
      const item = map.get(uid) ?? { uid, assessor: nomeAssessor, total: 0 };
      item.total += 1;
      map.set(uid, item);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  // ====== Modal com cards ======
  abrirCadastros(uid: string, nome: string) {
    this.selectedAssessorUid = uid;
    this.selectedAssessorNome = nome;

    const lista = this.rows()
      .filter((r) => (uid ? r.createdByUid === uid : true))
      .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

    this.selectedCadastros = lista;

    if (this.cadastrosModalRef) {
      this.cadastrosModal = new bootstrap.Modal(this.cadastrosModalRef.nativeElement, { backdrop: 'static' });
      this.cadastrosModal.show();
    }
  }

  fecharCadastros() {
    this.cadastrosModal?.hide();
  }

  // ====== Ações dos cards ======
  editarCadastro(c: RowVM) {
    // Segue a mesma convenção da sua ListagemCadastros:
    const { ...rest } = c as any;
    localStorage.setItem('clienteEditando', JSON.stringify(rest));
    this.fecharCadastros();
    this.router.navigate(['/cadastro']); // ajuste se sua rota de edição for outra
  }

  async excluirCadastro(c: RowVM) {
    if (!c?.id) return;
    const ok = confirm('Tem certeza que deseja remover este cadastro?');
    if (!ok) return;

    try {
      await fsDeleteDoc(fsDoc(this.afs as any, 'clientes', c.id));
      // remove da memória e atualiza seleção
      this.rows.set(this.rows().filter((r) => r.id !== c.id));
      this.selectedCadastros = this.selectedCadastros.filter((r) => r.id !== c.id);
    } catch (e) {
      console.error('[Relatório Cadastros] erro ao excluir:', e);
      alert('Falha ao remover o cadastro.');
    }
  }
}
