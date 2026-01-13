import { Component, OnInit, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc, getDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';

import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { PreCadastro } from '../../../models/pre-cadastro.model';

declare const bootstrap: any;

type Papel = 'admin' | 'supervisor' | 'coordenador' | 'rh' | 'assessor' | 'desconhecido';

type RowVM = PreCadastro & {
  data: Date | null;
  nome: string;

  // Campos opcionais comuns no pré-cadastro
  cpf?: string;
  telefone?: string;
  contato?: string;
  email?: string;
  endereco?: string;
  enderecoCompleto?: string;

  // autoria/ids (ajuste conforme seu modelo)
  createdByUid?: string;
  createdByNome?: string;
  id?: string;
  uid?: string;
  nomeCompleto?: string;
};

@Component({
  selector: 'app-pre-cadastro-relatorio',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pre-cadastro-relatorio.component.html',
  styleUrls: ['./pre-cadastro-relatorio.component.css'],
})
export class PreCadastroRelatorioComponent implements OnInit {
  private service = inject(PreCadastroService);
  public auth = inject(Auth);
  private afs = inject(Firestore);
  private router = inject(Router);

  loading = signal(false);
  erro = signal<string | null>(null);

  papel: Papel = 'desconhecido';
  rows = signal<RowVM[]>([]);

  // Modal (cards)
  @ViewChild('preCadastrosModal', { static: false }) preCadastrosModalRef?: ElementRef<HTMLDivElement>;
  private preCadastrosModal?: any;
  selectedAssessorUid: string | null = null;
  selectedAssessorNome = '';
  selectedPreCadastros: RowVM[] = [];

  async ngOnInit() {
    this.loading.set(true);
    this.erro.set(null);

    try {
      await this.resolvePapel();

      // Carrega todos os pré-cadastros
      const raw = await this.service.listarTodos();

      // Mapeia para a ViewModel com datas normalizadas e nome amigável
      const mapped: RowVM[] = (raw as any[]).map((r) => ({
        ...r,
        data: this.toDate((r as any)?.createdAt),
        nome: (r as any)?.nomeCompleto ?? (r as any)?.nome ?? '',
      }));
      this.rows.set(mapped);
    } catch (e: any) {
      console.error('[Relatório] erro:', e);
      this.erro.set(e?.message || 'Erro ao carregar relatório.');
    } finally {
      this.loading.set(false);
    }
  }

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
    console.log('[Relatório] papel detectado:', raw, '→', this.papel);
  }

  private toDate(x: unknown): Date | null {
    if (!x) return null;
    // Firestore Timestamp tem .toDate()
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }

  // === Visões ===
  meus(): RowVM[] {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return [];
    return this.rows().filter((r) => r.createdByUid === uid);
  }

  porAssessor(): Array<{ uid: string; assessor: string; total: number }> {
    const map = new Map<string, { uid: string; assessor: string; total: number }>();
    for (const r of this.rows()) {
      const uid = r.createdByUid ?? 'sem-uid';
      const nomeAssessor = r.createdByNome || 'Assessor';
      const item = map.get(uid) ?? { uid, assessor: nomeAssessor, total: 0 };
      item.total += 1;
      map.set(uid, item);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  // === Modal com cards de pré-cadastros ===
  abrirPreCadastros(uid: string, nome: string) {
    this.selectedAssessorUid = uid;
    this.selectedAssessorNome = nome;

    const lista = this.rows()
      .filter((r) => (uid ? r.createdByUid === uid : true))
      .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

    this.selectedPreCadastros = lista;

    if (this.preCadastrosModalRef) {
      this.preCadastrosModal = new bootstrap.Modal(this.preCadastrosModalRef.nativeElement, { backdrop: 'static' });
      this.preCadastrosModal.show();
    }
  }

  fecharPreCadastros() {
    this.preCadastrosModal?.hide();
  }

  verDetalhes(pc: RowVM) {
    // Caso exista página de detalhes, ajuste a rota:
    // this.router.navigate(['/pre-cadastro/detalhe', pc.id ?? pc.uid]);
    console.log('[Pré-cadastro] detalhes:', pc);
  }

iniciarCadastro(pc: RowVM) {
  const qp = this.buildQueryFromPre(pc);

  // fecha o modal (opcional, só pra UX)
  this.fecharPreCadastros();

  // navega ABSOLUTO para /cadastro/novo
  this.router.navigate(['/cadastro', 'novo'], { queryParams: qp });
}

private onlyDigits(v?: string): string {
  return (v ?? '').replace(/\D/g, '');
}

private buildQueryFromPre(pc: RowVM): Record<string, any> {
  const contato = this.onlyDigits(pc.telefone ?? pc.contato ?? '');
  const cpf = this.onlyDigits(pc.cpf ?? '');
  return {
    nome: pc.nomeCompleto ?? pc.nome ?? '',
    cpf,
    contato, // mesmo nome que o CadastroForm lê
    email: pc.email ?? '',
    endereco: pc.endereco ?? pc.enderecoCompleto ?? '',
    preCadastroId: pc.id ?? pc.uid ?? '',
  };
}

}
