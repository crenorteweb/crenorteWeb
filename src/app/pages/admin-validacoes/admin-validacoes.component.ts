import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Firestore, collection, getDocs, updateDoc, deleteDoc, doc, writeBatch, query, where, getDoc,
} from '@angular/fire/firestore';
import { HeaderComponent } from '../shared/header/header.component';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type Aba = 'normalizacao' | 'cpfs' | 'exportar' | 'criador' | 'status';
type Campo = 'cidade' | 'bairro' | 'estado' | 'origem';

interface Registro {
  id: string;
  nomeCompleto?: string;
  cpf?: string;
  cidade?: string;
  bairro?: string;
  estado?: string;
  origem?: string;
  [key: string]: any;
}

interface GrupoValor {
  valorOriginal: string;              // valor com mais ocorrências (representativo)
  variantes: string[];                // todos os valores distintos do grupo
  registros: Registro[];             // todos os registros com qualquer variante
  count: number;
  __col_map: Record<string, string>; // id → nome da coleção
}

interface GrupoCpf {
  cpf: string;
  registros: Registro[];
}

@Component({
  selector: 'app-admin-validacoes',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './admin-validacoes.component.html',
})
export class AdminValidacoesComponent implements OnInit {
  private fs = inject(Firestore);

  aba = signal<Aba>('normalizacao');
  loading = signal(false);
  salvando = signal(false);
  toast = signal<{ msg: string; tipo: 'success' | 'danger' } | null>(null);

  // ── Todos os registros carregados ────────────────────────────────────────
  todosRegistros = signal<Registro[]>([]);

  // ── Aba Normalização ─────────────────────────────────────────────────────
  campo = signal<Campo>('cidade');
  buscaNorm = signal('');

  /** Agrupa todos os registros pelo campo selecionado, insensível a maiúsculas/acentos */
  grupos = computed<GrupoValor[]>(() => {
    const c = this.campo();
    const map = new Map<string, { valCount: Map<string, number>; registros: Registro[] }>();

    for (const r of this.todosRegistros()) {
      const raw: string = (r[c] || '').trim();
      if (!raw) continue;
      const key = this.norm(raw);
      if (!map.has(key)) map.set(key, { valCount: new Map(), registros: [] });
      const entry = map.get(key)!;
      entry.valCount.set(raw, (entry.valCount.get(raw) ?? 0) + 1);
      entry.registros.push(r);
    }

    return Array.from(map.entries())
      .map(([, entry]) => {
        // valor representativo = o que aparece mais vezes
        let valorOriginal = '';
        let max = 0;
        entry.valCount.forEach((cnt, val) => { if (cnt > max) { max = cnt; valorOriginal = val; } });
        const variantes = Array.from(entry.valCount.keys()).sort();
        const __col_map: Record<string, string> = {};
        entry.registros.forEach(r => { __col_map[r.id] = r['__col'] ?? 'pre_cadastros'; });
        return { valorOriginal, variantes, registros: entry.registros, count: entry.registros.length, __col_map };
      })
      .sort((a, b) => b.count - a.count);
  });

  gruposFiltrados = computed<GrupoValor[]>(() => {
    const busca = this.norm(this.buscaNorm());
    if (!busca) return this.grupos();
    return this.grupos().filter(g =>
      g.variantes.some(v => this.norm(v).includes(busca))
    );
  });

  // Estado da edição inline de cada grupo
  editandoGrupo = signal<Map<string, string>>(new Map()); // key normalizado → novoValor
  selecionados = signal<Set<string>>(new Set());           // ids de registros selecionados

  // Grupo expandido para ver variantes/registros
  expandido = signal<string | null>(null);

  // ── Aba CPFs Duplicados ──────────────────────────────────────────────────
  buscaCpf = signal('');
  cpfExpandido = signal<string | null>(null);

  gruposCpf = computed<GrupoCpf[]>(() => {
    const map = new Map<string, Registro[]>();
    for (const r of this.todosRegistros()) {
      const cpf = (r.cpf || '').replace(/\D/g, '');
      if (!cpf) continue;
      if (!map.has(cpf)) map.set(cpf, []);
      map.get(cpf)!.push(r);
    }
    return Array.from(map.entries())
      .filter(([, rs]) => rs.length > 1)
      .map(([cpf, registros]) => ({ cpf, registros }))
      .sort((a, b) => b.registros.length - a.registros.length);
  });

  gruposCpfFiltrados = computed<GrupoCpf[]>(() => {
    const busca = this.buscaCpf().replace(/\D/g, '');
    if (!busca) return this.gruposCpf();
    return this.gruposCpf().filter(g => g.cpf.includes(busca));
  });

  // Estado de edição inline dos registros duplicados
  editandoCpfReg = signal<Map<string, Partial<Registro>>>(new Map()); // id → patch

  // IDs já excluídos do Firestore mas ainda não removidos da lista
  deletadosCpf = signal<Set<string>>(new Set());

  // ── Aba Status (pendente → nao_verificado) ──────────────────────────────
  buscaStatus = signal('');
  selecionadosStatus = signal<Set<string>>(new Set());

  registrosStatusFiltrados = computed<Registro[]>(() => {
    const busca = this.norm(this.buscaStatus());
    return this.todosRegistros().filter(r => {
      const aprovStatus = r['aprovacao']?.status;
      if (aprovStatus !== 'pendente') return false;
      if (!busca) return true;
      return (
        this.norm(r.nomeCompleto || '').includes(busca) ||
        (r.cpf || '').replace(/\D/g, '').includes(busca.replace(/\D/g, ''))
      );
    });
  });

  todosStatusSelecionados = computed<boolean>(() => {
    const regs = this.registrosStatusFiltrados();
    if (!regs.length) return false;
    return regs.every(r => this.selecionadosStatus().has(r.id));
  });

  // ── Aba Criador do Cadastro ──────────────────────────────────────────────
  buscaCriador = signal('');
  novoUidInput = signal('');
  selecionadosCriador = signal<Set<string>>(new Set());

  registrosFiltradosCriador = computed<Registro[]>(() => {
    const busca = this.norm(this.buscaCriador());
    return this.todosRegistros().filter(r => {
      const ehSitePortal =
        r['createdByUid'] === 'site_portal' && r['createdByNome'] === 'Site Crenorte';
      if (!ehSitePortal) return false;
      if (!busca) return true;
      return (
        this.norm(r.nomeCompleto || '').includes(busca) ||
        (r.cpf || '').replace(/\D/g, '').includes(busca.replace(/\D/g, ''))
      );
    });
  });

  todosCriadorSelecionados = computed<boolean>(() => {
    const regs = this.registrosFiltradosCriador();
    if (!regs.length) return false;
    const sel = this.selecionadosCriador();
    return regs.every(r => sel.has(r.id));
  });

  ngOnInit() { this.carregarTudo(); }

  async carregarTudo() {
    this.loading.set(true);
    try {
      const [snap1, snap2] = await Promise.all([
        getDocs(collection(this.fs, 'pre_cadastros')),
        getDocs(collection(this.fs, 'pre-cadastros')),
      ]);
      const seen = new Set<string>();
      const lista: Registro[] = [];
      const processar = (snap: any, colName: string) => {
        snap.forEach((d: any) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          lista.push({ id: d.id, __col: colName, ...d.data() as any });
        });
      };
      processar(snap1, 'pre_cadastros');
      processar(snap2, 'pre-cadastros');
      this.todosRegistros.set(lista);
    } catch (e) {
      this.showToast('Erro ao carregar dados.', 'danger');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Normalização ─────────────────────────────────────────────────────────

  setEditando(chaveNorm: string, valor: string) {
    const m = new Map(this.editandoGrupo());
    m.set(chaveNorm, valor);
    this.editandoGrupo.set(m);
  }

  getEditando(chaveNorm: string, fallback: string): string {
    return this.editandoGrupo().get(chaveNorm) ?? fallback;
  }

  toggleExpandido(chave: string) {
    this.expandido.set(this.expandido() === chave ? null : chave);
  }

  async aplicarNormalizacao(grupo: GrupoValor) {
    const chave = this.norm(grupo.valorOriginal);
    const novoValor = this.getEditando(chave, grupo.valorOriginal).trim();
    if (!novoValor) return;

    const campo = this.campo();
    const ids = grupo.registros.map(r => r.id);
    this.salvando.set(true);
    try {
      await this.batchUpdate(ids, grupo.__col_map ?? {}, { [campo]: novoValor });

      // Atualiza localmente
      this.todosRegistros.update(lista =>
        lista.map(r => ids.includes(r.id) ? { ...r, [campo]: novoValor } : r)
      );
      this.showToast(`${ids.length} registro(s) atualizados para "${novoValor}".`, 'success');
    } catch {
      this.showToast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando.set(false);
    }
  }

  // ── CPFs Duplicados ──────────────────────────────────────────────────────

  toggleCpfExpandido(cpf: string) {
    this.cpfExpandido.set(this.cpfExpandido() === cpf ? null : cpf);
  }

  setEditandoCpfReg(id: string, field: string, value: string) {
    const m = new Map(this.editandoCpfReg());
    const atual = m.get(id) ?? {};
    m.set(id, { ...atual, [field]: value });
    this.editandoCpfReg.set(m);
  }

  getEditandoCpfReg(id: string, field: string, fallback: string): string {
    return (this.editandoCpfReg().get(id)?.[field] as string) ?? fallback;
  }

  async salvarEdicaoCpf(reg: Registro) {
    const patch = this.editandoCpfReg().get(reg.id);
    if (!patch || !Object.keys(patch).length) return;
    this.salvando.set(true);
    try {
      const col = reg['__col'] ?? 'pre_cadastros';
      await updateDoc(doc(this.fs, col, reg.id), patch);
      this.todosRegistros.update(lista =>
        lista.map(r => r.id === reg.id ? { ...r, ...patch } : r)
      );
      const m = new Map(this.editandoCpfReg());
      m.delete(reg.id);
      this.editandoCpfReg.set(m);
      this.showToast('Registro atualizado.', 'success');
    } catch {
      this.showToast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando.set(false);
    }
  }

  async excluirRegistro(reg: Registro) {
    if (!confirm(`Excluir o registro de "${reg.nomeCompleto || reg.id}"?`)) return;
    this.salvando.set(true);
    try {
      const col = reg['__col'] ?? 'pre_cadastros';
      await deleteDoc(doc(this.fs, col, reg.id));

      // Marca como excluído sem alterar a lista ainda
      const excluidos = new Set(this.deletadosCpf());
      excluidos.add(reg.id);
      this.deletadosCpf.set(excluidos);

      // Conta quantos registros deste CPF ainda não foram excluídos
      const cpf = (reg.cpf || '').replace(/\D/g, '');
      const restantes = this.todosRegistros().filter(
        r => !excluidos.has(r.id) && (r.cpf || '').replace(/\D/g, '') === cpf
      );

      // Só atualiza a lista quando restar ≤ 1 (grupo deixa de ser duplicado)
      if (restantes.length <= 1) {
        this.todosRegistros.update(lista =>
          lista.filter(r => (r.cpf || '').replace(/\D/g, '') !== cpf)
        );
        // Limpa os IDs desse CPF do set de excluídos
        const novoSet = new Set(this.deletadosCpf());
        this.todosRegistros()
          .filter(r => (r.cpf || '').replace(/\D/g, '') === cpf)
          .forEach(r => novoSet.delete(r.id));
        novoSet.delete(reg.id);
        this.deletadosCpf.set(novoSet);
      }

      this.showToast('Registro excluído.', 'success');
    } catch {
      this.showToast('Erro ao excluir.', 'danger');
    } finally {
      this.salvando.set(false);
    }
  }

  // ── Criador do Cadastro ──────────────────────────────────────────────────

  toggleSelecionadoCriador(id: string) {
    const s = new Set(this.selecionadosCriador());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selecionadosCriador.set(s);
  }

  toggleTodosCriador() {
    const regs = this.registrosFiltradosCriador();
    const sel = this.selecionadosCriador();
    const nova = new Set(sel);
    if (regs.every(r => sel.has(r.id))) {
      regs.forEach(r => nova.delete(r.id));
    } else {
      regs.forEach(r => nova.add(r.id));
    }
    this.selecionadosCriador.set(nova);
  }

  async aplicarCriador() {
    const uid = this.novoUidInput().trim();
    if (!uid) { this.showToast('Informe o UID do colaborador.', 'danger'); return; }
    const ids = Array.from(this.selecionadosCriador());
    if (!ids.length) { this.showToast('Selecione ao menos um registro.', 'danger'); return; }

    this.salvando.set(true);
    try {
      // Resolve nome: tenta document ID primeiro (assessores), depois campo uid (analistas)
      let nome: string | null = null;
      const docSnap = await getDoc(doc(this.fs, 'colaboradores', uid));
      if (docSnap.exists()) {
        nome = (docSnap.data() as any)['nome'] || null;
      } else {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', uid)));
        if (!snap.empty) nome = (snap.docs[0].data() as any)['nome'] || null;
      }
      if (!nome) {
        this.showToast('UID não encontrado na coleção de colaboradores.', 'danger');
        return;
      }

      const colMap: Record<string, string> = {};
      for (const r of this.todosRegistros()) {
        if (ids.includes(r.id)) colMap[r.id] = r['__col'] ?? 'pre_cadastros';
      }
      await this.batchUpdate(ids, colMap, { createdByUid: uid, createdByNome: nome });
      this.todosRegistros.update(lista =>
        lista.map(r => ids.includes(r.id) ? { ...r, createdByUid: uid, createdByNome: nome } : r)
      );
      this.selecionadosCriador.set(new Set());
      this.novoUidInput.set('');
      this.showToast(`${ids.length} registro(s) atualizados para "${nome}".`, 'success');
    } catch {
      this.showToast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando.set(false);
    }
  }

  // ── Status (pendente → nao_verificado) ──────────────────────────────────

  toggleSelecionadoStatus(id: string) {
    const s = new Set(this.selecionadosStatus());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selecionadosStatus.set(s);
  }

  toggleTodosStatus() {
    const regs = this.registrosStatusFiltrados();
    const sel = this.selecionadosStatus();
    const nova = new Set(sel);
    if (regs.every(r => sel.has(r.id))) {
      regs.forEach(r => nova.delete(r.id));
    } else {
      regs.forEach(r => nova.add(r.id));
    }
    this.selecionadosStatus.set(nova);
  }

  async aplicarResetStatus() {
    const ids = Array.from(this.selecionadosStatus());
    if (!ids.length) { this.showToast('Selecione ao menos um registro.', 'danger'); return; }
    if (!confirm(`Alterar aprovacao.status de "pendente" para "nao_verificado" em ${ids.length} registro(s)?`)) return;

    this.salvando.set(true);
    try {
      const colMap: Record<string, string> = {};
      for (const r of this.todosRegistros()) {
        if (ids.includes(r.id)) colMap[r.id] = r['__col'] ?? 'pre_cadastros';
      }
      await this.batchUpdate(ids, colMap, { 'aprovacao.status': 'nao_verificado' });
      this.todosRegistros.update(lista =>
        lista.map(r => ids.includes(r.id)
          ? { ...r, aprovacao: { ...(r['aprovacao'] ?? {}), status: 'nao_verificado' } }
          : r
        )
      );
      this.selecionadosStatus.set(new Set());
      this.showToast(`${ids.length} registro(s) atualizados para "nao_verificado".`, 'success');
    } catch {
      this.showToast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando.set(false);
    }
  }

  // ── Exportar ─────────────────────────────────────────────────────────────

  exportarLista(campo: Campo) {
    const map = new Map<string, number>();
    for (const r of this.todosRegistros()) {
      const v = (r[campo] || '').trim();
      if (!v) continue;
      map.set(v, (map.get(v) ?? 0) + 1);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([valor, count]) => ({ [campo]: valor, total: count }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, campo);
    XLSX.writeFile(wb, `lista_${campo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  exportarListaPdf(campo: Campo) {
    const map = new Map<string, number>();
    for (const r of this.todosRegistros()) {
      const v = (r[campo] || '').trim();
      if (!v) continue;
      map.set(v, (map.get(v) ?? 0) + 1);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([valor, count], i) => [i + 1, valor, count]);

    const titulo = campo === 'cidade' ? 'Lista de Cidades' : 'Lista de Bairros';
    const colHeader = campo === 'cidade' ? 'Cidade' : 'Bairro';

    const pdf = new jsPDF();
    pdf.setFontSize(14);
    pdf.text(`Crenorte – ${titulo}`, 14, 16);
    pdf.setFontSize(9);
    pdf.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}   Total: ${map.size} ${campo === 'cidade' ? 'cidade(s)' : 'bairro(s)'}`, 14, 22);

    autoTable(pdf, {
      startY: 28,
      head: [['#', colHeader, 'Total de registros']],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 167, 69] },
      columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 36, halign: 'center' } },
    });

    pdf.save(`lista_${campo}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  exportarCpfsDuplicados() {
    const rows: any[] = [];
    for (const g of this.gruposCpf()) {
      g.registros.forEach(r => rows.push({
        cpf: g.cpf,
        nome: r.nomeCompleto || '—',
        cidade: r.cidade || '—',
        bairro: r.bairro || '—',
        estado: r.estado || '—',
        origem: r.origem || '—',
        id: r.id,
      }));
      rows.push({});
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CPFs Duplicados');
    XLSX.writeFile(wb, `cpfs_duplicados_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  norm(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  toDataStr(ts: any): string {
    if (!ts) return '—';
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return '—'; }
  }

  cpfMask(cpf?: string): string {
    const d = (cpf || '').replace(/\D/g, '');
    if (d.length !== 11) return cpf || '—';
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }

  private async batchUpdate(ids: string[], colMap: Record<string, string>, patch: Record<string, any>) {
    // Firestore batch: máx 500 operações por batch
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 490) chunks.push(ids.slice(i, i + 490));

    for (const chunk of chunks) {
      const batch = writeBatch(this.fs);
      for (const id of chunk) {
        const colName = colMap[id] ?? 'pre_cadastros';
        batch.update(doc(this.fs, colName, id), patch);
      }
      await batch.commit();
    }
  }

  private showToast(msg: string, tipo: 'success' | 'danger') {
    this.toast.set({ msg, tipo });
    setTimeout(() => this.toast.set(null), 3500);
  }

  // Conta quantas variantes distintas um grupo tem (mais de 1 = inconsistência)
  temVariantes(g: GrupoValor): boolean {
    return g.variantes.length > 1;
  }
}
