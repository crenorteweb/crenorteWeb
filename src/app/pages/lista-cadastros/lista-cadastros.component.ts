import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

import {
  ClienteDoc,
  listarDoAssessor,
  atualizarCliente,
  removerCliente,
} from '../../services/cadastro.service';
import { normalizarTexto } from '../../core/constants/regioes-prioritarias.constant';

// 👇 Extensão local só para o template aceitar campos opcionais
type ClienteView = ClienteDoc & {
  cpfFormatado?: string | null;
  contatoFormatado?: string | null;
  createdAt?: any;   // Firestore Timestamp
  criadoEm?: any;    // Date | string | Timestamp
  status?: string | null;
  [k: string]: any;
};

@Component({
  selector: 'app-lista-cadastros',
  standalone: true,
  // ❌ Sem DatePipe/NgxMaskDirective (não usados) → some o warning
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './lista-cadastros.component.html',
  styleUrls: ['./lista-cadastros.component.css'],
})
export class ListaCadastrosComponent implements OnInit, OnDestroy {
  private auth = inject(Auth);

  loading = signal(true);
  itens = signal<ClienteView[]>([]);
  private sub?: Subscription;

  // ====== Filtros ======
  searchTerm = signal<string>('');
  searchCpf = signal<string>('');
  filtroOrigem = signal<string>('');

  private onlyDigits(v?: string | null): string {
    return (v ?? '').replace(/\D+/g, '');
  }

  origensDisponiveis = computed<string[]>(() => {
    const set = new Set<string>();
    for (const i of this.itens()) {
      const o = (i.origem ?? '').toString().trim();
      if (o) set.add(o);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  itensFiltrados = computed<ClienteView[]>(() => {
    const term = normalizarTexto(this.searchTerm());
    const cpfBusca = this.onlyDigits(this.searchCpf());
    const origem = this.filtroOrigem();

    return this.itens().filter((i) => {
      if (term) {
        const nome = normalizarTexto(i.nomeCompleto ?? '');
        if (!nome.includes(term)) return false;
      }
      if (cpfBusca) {
        const cpfItem = this.onlyDigits(i.cpf);
        if (!cpfItem.includes(cpfBusca)) return false;
      }
      if (origem && (i.origem ?? '') !== origem) return false;
      return true;
    });
  });

  // estado modais
  modalVerAberto = signal(false);
  modalEditarAberto = signal(false);
  viewItem = signal<ClienteView | null>(null);
  editModel = signal<ClienteView | null>(null);
  saving = signal(false);

  ngOnInit(): void {
    this.sub = user(this.auth).subscribe(async (u) => {
      this.loading.set(true);
      try {
        if (!u) {
          this.itens.set([]);
          return;
        }
        const rows = await listarDoAssessor(u.uid);
        // Garante o tipo ClienteView
        this.itens.set(rows as ClienteView[]);
      } catch (err) {
        console.error('[Cadastros] Erro ao listar:', err);
        this.itens.set([]);
      } finally {
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  abrirVer(i: ClienteView) {
    this.viewItem.set(i);
    this.modalVerAberto.set(true);
  }

  abrirEditar(i: ClienteView) {
    this.editModel.set({
      ...i,
      cpf: (i.cpf ?? '').toString().replace(/\D/g, ''),
      contato: (i.contato ?? '').toString().replace(/\D/g, ''),
      email: (i.email ?? '').toString().trim(),
      nomeCompleto: (i.nomeCompleto ?? '').toString().trim(),
    });
    this.modalEditarAberto.set(true);
  }

  fecharModais() {
    this.modalVerAberto.set(false);
    this.modalEditarAberto.set(false);
    this.viewItem.set(null);
    this.editModel.set(null);
  }

  async salvarEdicao() {
    const m = this.editModel();
    if (!m?.id) return;

    this.saving.set(true);
    try {
      const patch: Partial<ClienteDoc> = {
        nomeCompleto: (m.nomeCompleto ?? null) as any,
        cpf: (m.cpf ?? '').toString().replace(/\D/g, '') || (null as any),
        contato: (m.contato ?? '').toString().replace(/\D/g, '') || (null as any),
        email: (m.email ?? '').toString().trim() || (null as any),
        endereco: (m.endereco ?? '').toString().trim() || (null as any),
        bairro: (m.bairro ?? '').toString().trim() || (null as any),
        origem: (m.origem ?? '').toString().trim() || (null as any),
      };
      await atualizarCliente(m.id, patch);
      this.itens.update((list) =>
        list.map((x) => (x.id === m.id ? ({ ...x, ...patch } as ClienteView) : x))
      );
      this.fecharModais();
      alert('Cadastro atualizado com sucesso!');
    } catch (err) {
      console.error('[Cadastros] Erro ao salvar edição:', err);
      alert('Falha ao salvar edição.');
    } finally {
      this.saving.set(false);
    }
  }

  async remover(item: ClienteView) {
    if (!item?.id) return;
    const ok = confirm(`Remover o cadastro de "${item.nomeCompleto ?? 'sem nome'}"?`);
    if (!ok) return;

    try {
      await removerCliente(item.id);
      this.itens.update((lista) => lista.filter((x) => x.id !== item.id));
    } catch (err) {
      console.error('[Cadastros] Erro ao remover:', err);
      alert('Falha ao remover. Tente novamente.');
    }
  }

  // Helper para renderizar data no template (aceita Timestamp, Date ou string)
  asDate(value: any): Date | null {
    try {
      if (!value) return null;
      if (typeof value?.toDate === 'function') return value.toDate(); // Firestore Timestamp
      if (value instanceof Date) return value;
      const parsed = new Date(value);
      return isNaN(+parsed) ? null : parsed;
    } catch {
      return null;
    }
  }
}
