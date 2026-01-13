import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  limit,
  startAfter,
  getCountFromServer,
  QueryDocumentSnapshot,
  Query,
  DocumentData,
  QuerySnapshot,
  deleteDoc,
  updateDoc,
  doc,
} from 'firebase/firestore';

import { db } from '../../firebase.config';
import { Cliente } from '../../models/cliente.model';
import { HeaderComponent } from '../shared/header/header.component';

type ClienteList = Cliente & {
  id: string;
  _thumbUrl?: string | null;
  _assinaturaUrl?: string | null;
  status?: 'em_analise' | 'aprovado' | 'reprovado';
};

type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-listagem-cadastros',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  styleUrls: ['./listagem-cadastros.component.css'],
  templateUrl: './listagem-cadastros.component.html',
})
export class ListagemCadastrosComponent implements OnInit {
  // helpers de status (cores e labels)
  statusLabel(s?: string) {
    return s === 'aprovado' ? 'Aprovado'
         : s === 'reprovado' ? 'Reprovado'
         : 'Em Análise';
  }
  statusClass(s?: string) {
    return s === 'aprovado' ? 'bg-success-subtle text-success border'
         : s === 'reprovado' ? 'bg-danger-subtle text-danger border'
         : 'bg-warning-subtle text-warning border'; // em_analise ou indefinido
  }

  // dados em memória
  clientesAll: ClienteList[] = [];
  clientesFiltrados: ClienteList[] = [];
  clientesPaginados: ClienteList[] = [];

  // filtros
  filtro: {
    nome: string;
    cidade: string;
    empreende: '' | 'Sim' | 'Não';
    crenorte: '' | 'Sim' | 'Não';
    dataDe?: string;
    dataAte?: string;
  } = { nome: '', cidade: '', empreende: '', crenorte: '', dataDe: '', dataAte: '' };

  // paginação local
  clientesPorPagina = 20;
  paginaAtual = 1;
  totalPaginas = 1;
  totalEstimado = 0;

  // ordenação (Nome e Data)
  sortField: 'nomeCompleto' | 'dataPreenchimento' = 'dataPreenchimento';
  sortDir: SortDir = 'desc';

  // ui
  carregando = false;
  migrando = false;
  erroCarregar = '';

  // preview
  preview = {
    open: false,
    titulo: '',
    imgUrl: null as string | null,
    assinaturaUrl: null as string | null,
  };

  // ===== NOVO: data escolhida para exportar "nomes do dia" =====
  dataExportDia: string = ''; // formato yyyy-mm-dd do input[type="date"]

  async ngOnInit(): Promise<void> {
    await this.carregarTodos();
  }

  // ====================== FORMATADORES ======================
  public displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);

    const keepLower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts
      .map((p, i) => {
        if (i > 0 && keepLower.has(p)) return p;
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join(' ');
  }

  public maskCPF(cpf?: string): string {
    const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
    if (d.length !== 11) return cpf || '';
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  public maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11) return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }

  public getPhone(c: any): string {
    return (c?.contato ?? c?.telefone ?? '') as string;
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

  public toBRDate(value: any): string {
    const d = this.asDate(value);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private pickFirstUrl(anexos: Record<string, string[]> | undefined, keysInOrder: string[]): string | null {
    if (!anexos) return null;
    for (const k of keysInOrder) {
      const arr = anexos[k];
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') return arr[0];
    }
    return null;
  }

  private extractThumbAndAssinatura(c: Cliente): { thumb: string | null; assinatura: string | null } {
    const anexos = (c as any)?.anexos as Record<string, string[]> | undefined;
    const thumb = this.pickFirstUrl(anexos, [
      'fotoPessoa',
      'selfieDocumento',
      'docPessoa',
      'fotoEmpreendimento',
      'fotoProdutos',
      'orcamento',
      'planoNegocio',
    ]);
    const assinatura = this.pickFirstUrl(anexos, ['assinatura']);
    return { thumb, assinatura };
  }

  // ====================== CARGA TOTAL + PAGINAÇÃO LOCAL ======================
  private async carregarTodos() {
    this.carregando = true;
    this.erroCarregar = '';
    this.clientesAll = [];
       this.clientesFiltrados = [];
    this.clientesPaginados = [];
    this.paginaAtual = 1;

    try {
      const countSnap = await getCountFromServer(query(collection(db, 'clientes')));
      this.totalEstimado = (countSnap.data() as any).count || 0;

      const pageSize = 500;
      let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

      while (true) {
        let qy: Query<DocumentData>;
        if (lastDoc) {
          qy = query(
            collection(db, 'clientes'),
            orderBy('nomeCompleto'),
            startAfter(lastDoc),
            limit(pageSize),
          );
        } else {
          qy = query(collection(db, 'clientes'), orderBy('nomeCompleto'), limit(pageSize));
        }

        const snap: QuerySnapshot<DocumentData> = await getDocs(qy);
        if (snap.empty) break;

        const chunk: ClienteList[] = snap.docs.map((d) => {
          const dados = d.data() as any;
          const { thumb, assinatura } = this.extractThumbAndAssinatura(dados);
          return {
            id: d.id,
            ...dados,
            _thumbUrl: thumb,
            _assinaturaUrl: assinatura
          } as ClienteList;
        });

        this.clientesAll.push(...chunk);
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize) break;
      }

      this.aplicarFiltrosLocais(true);
    } catch (e) {
      console.error(e);
      this.erroCarregar = 'Erro ao carregar os cadastros do Firebase.';
    } finally {
      this.carregando = false;
    }
  }

  private recalcularPaginacao() {
    this.totalPaginas = Math.max(1, Math.ceil(this.clientesFiltrados.length / this.clientesPorPagina));
    if (this.paginaAtual > this.totalPaginas) this.paginaAtual = this.totalPaginas;
    const ini = (this.paginaAtual - 1) * this.clientesPorPagina;
    const fim = ini + this.clientesPorPagina;
    this.clientesPaginados = this.clientesFiltrados.slice(ini, fim);
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

  // ====================== BUSCA / FILTROS / ORDENAÇÃO ======================
  onFiltroNomeChange(v: string) {
    this.filtro.nome = v;
    this.aplicarFiltrosLocais();
  }

  aplicarFiltrosLocais(resetPagina = false) {
    const nl = this.normalize(this.filtro.nome);
    const cidade = this.normalize(this.filtro.cidade);
    const empreende = this.filtro.empreende;
    const crenorte = this.filtro.crenorte;

    let arr = [...this.clientesAll];

    if (nl) arr = arr.filter((c) => this.normalize(this.displayName(c.nomeCompleto)).includes(nl));
    if (cidade) arr = arr.filter((c) => this.normalize((c as any).cidade || '').includes(cidade));

    if (empreende) {
      const want = empreende === 'Sim';
      arr = arr.filter((c) => !!(c as any).jaEmpreende === want);
    }
    if (crenorte) {
      const want = crenorte === 'Sim';
      arr = arr.filter((c) => !!(c as any).clienteCrenorte === want);
    }

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const start = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const end = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter((c) => {
        const d = this.asDate((c as any).dataPreenchimento);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    this.clientesFiltrados = this.ordenarArray(arr, this.sortField, this.sortDir);

    if (resetPagina) this.paginaAtual = 1;
    this.recalcularPaginacao();
  }

  ordenarPor(campo: 'nomeCompleto' | 'dataPreenchimento') {
    if (this.sortField === campo) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = campo;
      this.sortDir = 'asc';
    }
    this.clientesFiltrados = this.ordenarArray(this.clientesFiltrados, this.sortField, this.sortDir);
    this.recalcularPaginacao();
  }

  private ordenarArray(arr: ClienteList[], campo: 'nomeCompleto' | 'dataPreenchimento', dir: SortDir): ClienteList[] {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any;
      let vb: any;

      if (campo === 'dataPreenchimento') {
        va = this.asDate((a as any).dataPreenchimento)?.getTime() ?? 0;
        vb = this.asDate((b as any).dataPreenchimento)?.getTime() ?? 0;
      } else {
        va = this.displayName((a as any).nomeCompleto).toLowerCase();
        vb = this.displayName((b as any).nomeCompleto).toLowerCase();
      }

      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    });
  }

  // ====================== PREVIEW / EDITAR / REMOVER ======================
  openPreview(c: ClienteList) {
    this.preview = {
      open: true,
      titulo: this.displayName(c.nomeCompleto) || 'Pré-visualização',
      imgUrl: c._thumbUrl ?? null,
      assinaturaUrl: c._assinaturaUrl ?? null,
    };
  }
  closePreview() {
    this.preview.open = false;
  }
  abrirEmNovaAba(url?: string | null) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  trackById(_i: number, c: ClienteList) {
    return c.id || (c as any).cpf;
  }

  editarCliente(cpfOuId: string) {
    const cliente = this.clientesAll.find((c) => ((c as any).cpf ?? c.id) === cpfOuId || c.id === cpfOuId);
    if (!cliente) return;
    const { _thumbUrl, _assinaturaUrl, ...rest } = cliente as any;
    localStorage.setItem(
      'clienteEditando',
      JSON.stringify({
        ...rest,
        nomeCompleto: this.displayName(rest.nomeCompleto),
        _thumbUrl: _thumbUrl ?? null,
        _assinaturaUrl: _assinaturaUrl ?? null,
      }),
    );
    window.location.href = '/cadastro';
  }

  async removerCliente(id: string) {
    if (!id) return;
    const ok = window.confirm('Tem certeza que deseja remover este cadastro?');
    if (!ok) return;

    try {
      await deleteDoc(doc(db, 'clientes', id));
      this.clientesAll = this.clientesAll.filter((c) => c.id !== id);
      this.aplicarFiltrosLocais();
    } catch (e) {
      console.error(e);
      alert('Falha ao remover o cadastro.');
    }
  }

  // ====================== IMPORT/EXPORT ======================
  importarDoExcel(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const dados: any[] = XLSX.utils.sheet_to_json(sheet);
      if (!dados.length) return;

      try {
        for (const linha of dados) {
          await addDoc(collection(db, 'clientes'), {
            nomeCompleto: this.displayName(linha['Nome'] || ''),
            cpf: (linha['CPF'] || '').toString(),
            contato: (linha['Contato'] || linha['Telefone'] || '').toString(),
            cidade: linha['Cidade'] || '',
            valorSolicitado: Number(linha['Valor Solicitado']) || 0,
            dataPreenchimento: linha['Data Preenchimento']
              ? new Date(linha['Data Preenchimento']).toISOString()
              : new Date().toISOString(),
            status: 'em_analise',
            statusHistory: [{
              at: new Date(),
              byUid: 'import',
              byNome: 'Importação',
              from: undefined,
              to: 'em_analise',
              note: 'Status inicial via importação.'
            }]
          });
        }
        await this.carregarTodos();
        alert('✅ Importado!');
      } catch (err) {
        console.error(err);
        alert('Erro ao importar.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  exportarExcel() {
    const exportRows = this.clientesFiltrados.map((c) => ({
      Nome: this.displayName(c.nomeCompleto) || '',
      CPF: c.cpf || '',
      Telefone: this.maskPhone(this.getPhone(c)),
      'Data Preenchimento': this.toBRDate((c as any).dataPreenchimento),
      Status: this.statusLabel(c.status)
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, 'clientes-crenorte.xlsx');
  }

  /** ===================== NOVO: Exportar contatos (únicos) + nomes do dia escolhido ===================== */

  private isSameDay(value: any, year: number, month1to12: number, day: number): boolean {
    const d = this.asDate(value);
    if (!d) return false;
    return (
      d.getFullYear() === year &&
      d.getMonth() === month1to12 - 1 &&
      d.getDate() === day
    );
  }

  private labelFromISODate(isoDateYYYYMMDD: string): string {
    // recebe "2025-07-16" e devolve "16-07-2025" (para nomes de aba/arquivo)
    if (!isoDateYYYYMMDD) return '';
    const [yyyy, mm, dd] = isoDateYYYYMMDD.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }

  exportarContatosENomesDoDia() {
    if (!this.dataExportDia) {
      alert('Selecione uma data para exportar os nomes do dia.');
      return;
    }

    // Parse do input yyyy-mm-dd
    const [yearStr, monthStr, dayStr] = this.dataExportDia.split('-');
    const year = Number(yearStr);
    const month1to12 = Number(monthStr);
    const day = Number(dayStr);

    // --- Contatos únicos (de TODOS os cadastros) ---
    const seen = new Set<string>();
    const contatosUnicos = this.clientesAll.reduce<any[]>((acc, c) => {
      const phoneRaw = (this.getPhone(c) || '').toString();
      const phoneKey = phoneRaw.replace(/\D/g, '');
      const cpfKey = (c.cpf || '').toString().replace(/\D/g, '');
      const key = phoneKey || cpfKey || c.id;
      if (!key || seen.has(key)) return acc;
      seen.add(key);
      acc.push({
        Nome: this.displayName(c.nomeCompleto) || '',
        Telefone: this.maskPhone(this.getPhone(c)),
        CPF: this.maskCPF(c.cpf),
        Cidade: (c as any).cidade || '',
        'Data Preenchimento': this.toBRDate((c as any).dataPreenchimento),
        Status: this.statusLabel(c.status)
      });
      return acc;
    }, []);

    // --- Nomes SOMENTE do dia selecionado ---
    const nomesDoDia = this.clientesAll
      .filter((c) => this.isSameDay((c as any).dataPreenchimento, year, month1to12, day))
      .map((c) => ({
        Nome: this.displayName(c.nomeCompleto) || '',
        CPF: this.maskCPF(c.cpf),
        Telefone: this.maskPhone(this.getPhone(c)),
        Cidade: (c as any).cidade || '',
        'Data Preenchimento': this.toBRDate((c as any).dataPreenchimento),
        Status: this.statusLabel(c.status)
      }));

    // Monta workbook com 2 abas
    const wb = XLSX.utils.book_new();

    const wsContatos = XLSX.utils.json_to_sheet(contatosUnicos);
    XLSX.utils.book_append_sheet(wb, wsContatos, 'Contatos (Únicos)');

    const labelDia = this.labelFromISODate(this.dataExportDia); // ex.: "16-07-2025"
    const wsNomesDia = XLSX.utils.json_to_sheet(nomesDoDia);
    XLSX.utils.book_append_sheet(wb, wsNomesDia, `Nomes ${labelDia}`);

    // Gera arquivo
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    saveAs(blob, `contatos_e_nomes_${labelDia}.xlsx`);
  }

  // ====================== MIGRAÇÃO DE STATUS ======================
  async migrarStatus() {
    const ok = confirm(
      'Isso vai definir status "Em Análise" para cadastros que ainda não têm status, e registrar no histórico.\nDeseja continuar?'
    );
    if (!ok) return;

    this.migrando = true;
    try {
      const pendentes = this.clientesAll.filter(c => !c.status);

      const sanitize = (obj: Record<string, any>) => {
        const out: any = {};
        Object.keys(obj).forEach(k => {
          const v = (obj as any)[k];
          if (v !== undefined) out[k] = v;
        });
        return out;
      };

      const chunkSize = 50;
      for (let i = 0; i < pendentes.length; i += chunkSize) {
        const slice = pendentes.slice(i, i + chunkSize);

        await Promise.all(slice.map(async (c) => {
          const ref = doc(db, 'clientes', c.id);

          const currentHistory = Array.isArray((c as any).statusHistory)
            ? [...(c as any).statusHistory]
            : [];

          const newEvent = sanitize({
            at: new Date(),
            byUid: 'system',
            byNome: 'Backfill',
            to: 'em_analise' as const,
            note: 'Backfill de status inicial.'
          });

          const nextHistory = [...currentHistory, newEvent];

          await updateDoc(ref, sanitize({
            status: 'em_analise',
            statusHistory: nextHistory,
            atualizadoEm: new Date(),
          }));
        }));
      }

      await this.carregarTodos();
      alert('✅ Migração concluída!');
    } catch (e) {
      console.error(e);
      alert('❌ Erro na migração de status. Veja o console.');
    } finally {
      this.migrando = false;
    }
  }
}
