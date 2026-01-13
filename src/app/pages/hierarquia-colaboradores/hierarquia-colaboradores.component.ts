import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

import { HeaderComponent } from '../shared/header/header.component';

import { db } from '../../firebase.config';
import {
  collection,
  onSnapshot,
  Unsubscribe,
  doc,
  setDoc
} from 'firebase/firestore';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
type Status = 'ativo' | 'inativo';

export type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  status: Status;
  photoURL?: string | null;
  supervisorId?: string | null;
  analistaId?: string | null;
};

type Equipe = {
  id: string;               // `${supervisorId}__${analistaId || ''}`
  supervisorId: string;
  analistaId: string | null;
  nome: string;
};

type Bucket = {
  analista: Colaborador | null;
  assessores: Colaborador[];
  equipeId: string;
  equipeNome: string;
};

type GrupoSupervisor = {
  supervisor: Colaborador;
  buckets: Bucket[];        // agrupados por analista
  semAnalista: Colaborador[];
};

// ============================
// Pré-cadastros / produção
// ============================
type Formalizacao = {
  em?: any;
  porNome?: string;
  porUid?: string;
  status?: string;
  nomeCompleto?: string;
  origem?: string;
  parcelas?: number | null;
  telefone?: string;
};

type Desistencia = {
  status?: string;
  porUid?: string;
  porNome?: string;
  em?: any;
  observacao?: string | null;
};

type PreCadastroResumo = {
  id: string;
  nome?: string;
  nomeCompleto?: string;
  cpf?: string;
  cidade?: string;
  uf?: string;
  assessorId?: string | null;
  encaminhadoPorUid?: string | null;
  formalizacao?: Formalizacao | null;
  desistencia?: Desistencia | null;
};

type ResumoStats = {
  encaminhadosPorMim: number;
  total: number;
  formalizados: number;
  desistencias: number;
};

type CategoriaResumo = 'encaminhadosPorMim' | 'total' | 'formalizados' | 'desistencias';

@Component({
  standalone: true,
  selector: 'app-hierarquia-colaboradores',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './hierarquia-colaboradores.component.html',
  styleUrls: ['./hierarquia-colaboradores.component.css']
})
export class HierarquiaColaboradoresComponent implements OnInit, OnDestroy {
  private unsubColab?: Unsubscribe;
  private unsubEquipes?: Unsubscribe;
  private unsubPreCad?: Unsubscribe;

  private subUser?: Subscription;
  constructor(private auth: Auth) { }

  // estado
  busca = '';
  loading = signal<boolean>(true);
  erro = signal<string | null>(null);

  // usuário atual
  private currentUserUid: string | null = null;
  private currentColab: Colaborador | null = null;

  // edição de nome de time (um por vez)
  editEquipeId: string | null = null;
  editEquipeNome = '';

  // dados
  private todos = signal<Colaborador[]>([]);
  private equipesMap = new Map<string, Equipe>();

  private grupos = signal<GrupoSupervisor[]>([]);
  private bucketsSemSupervisor = signal<Bucket[]>([]);

  // pré-cadastros por assessor
  private prePorAssessor = new Map<string, PreCadastroResumo[]>();

  // ===== Modal de resumo por assessor =====
  showResumoModal = false;
  resumoAssessor: Colaborador | null = null;
  resumoStats: ResumoStats | null = null;

  viewResumoMode: 'cards' | 'lista' = 'cards';
  listaSelecionada: PreCadastroResumo[] = [];
  categoriaSelecionada: CategoriaResumo | null = null;
  categoriaLabelSelecionada = '';

  private listasPorCategoria: Partial<Record<CategoriaResumo, PreCadastroResumo[]>> = {};

  // ===== Lifecycle =====
  ngOnInit(): void {
    // ouvir Auth
    this.subUser = user(this.auth).subscribe(u => {
      this.currentUserUid = u?.uid ?? null;
      // quando o usuário muda, remontamos a árvore com o filtro adequado
      this.montarArvore();
    });

    this.subColaboradores();
    this.subEquipes();
    this.subPreCadastros();
  }

  ngOnDestroy(): void {
    this.unsubColab?.();
    this.unsubEquipes?.();
    this.unsubPreCad?.();
    this.subUser?.unsubscribe();
  }

  private syncCurrentColab(rows: Colaborador[]) {
    if (!this.currentUserUid) {
      this.currentColab = null;
      return;
    }

    this.currentColab =
      rows.find(r => r.uid === this.currentUserUid || r.id === this.currentUserUid) ?? null;
  }

  // ===== Firestore – colaboradores =====
  private subColaboradores() {
    this.loading.set(true);
    this.unsubColab = onSnapshot(collection(db, 'colaboradores'), snap => {
      const rows: Colaborador[] = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => (r.status ?? 'ativo') === 'ativo');

      this.todos.set(rows);
      // detectar quem é o usuário atual dentro da lista de colaboradores
      this.syncCurrentColab(rows);
      this.montarArvore();
      this.loading.set(false);
    }, err => {
      console.error(err);
      this.erro.set('Falha ao carregar colaboradores.');
      this.loading.set(false);
    });
  }

  private subEquipes() {
    this.unsubEquipes = onSnapshot(collection(db, 'equipes'), snap => {
      this.equipesMap.clear();
      snap.forEach(d => {
        const e = { id: d.id, ...(d.data() as any) } as Equipe;
        this.equipesMap.set(e.id, e);
      });
      // aplicar nomes nos buckets
      this.montarArvore();
    }, err => console.error(err));
  }

  // ===== Firestore – pré-cadastros (produção por assessor) =====
  private subPreCadastros() {
    this.unsubPreCad = onSnapshot(collection(db, 'pre_cadastros'), snap => {
      const map = new Map<string, PreCadastroResumo[]>();

      snap.forEach(d => {
        const data = d.data() as any;

        const formalizacao = (data.formalizacao ?? null) as Formalizacao | null;
        const desistencia = (data.desistencia ?? null) as Desistencia | null;

        const assessorId: string | null =
          data.designadoParaUid ??
          data.designadoPara ??
          data.caixaUid ??
          data.assessorId ??
          null;

        if (!assessorId) return;

        const pc: PreCadastroResumo = {
          id: d.id,
          nome: data.nome,
          nomeCompleto: data.nomeCompleto,
          cpf: data.cpf,
          cidade: data.cidade,
          uf: data.uf,
          assessorId,
          encaminhadoPorUid: data.encaminhadoPorUid ?? null,
          formalizacao,
          desistencia
        };

        if (!map.has(assessorId)) map.set(assessorId, []);
        map.get(assessorId)!.push(pc);
      });

      this.prePorAssessor = map;
    }, err => {
      console.error('Erro ao carregar pré-cadastros para resumo de produção:', err);
    });
  }

  // ===== Montagem da árvore =====
  public montarArvore(): void {
    const rows = this.todos();
    const me = this.currentColab; // supervisor ou analista logado (se existir)

    const nrm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // separar papéis
    let analistas = rows.filter(r => r.papel === 'analista')
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    let supervisores = rows.filter(r => r.papel === 'supervisor')
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    const assessoresBase = rows.filter(r => r.papel === 'assessor');

    // busca só filtra ASSESSORES
    let assessores = this.filtrarBusca(assessoresBase)
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    // === FILTRO PELO USUÁRIO LOGADO ===
    // Se for SUPERVISOR: mostra só o card dele
    if (me?.papel === 'supervisor') {
      supervisores = supervisores.filter(s => s.id === me.id);
      // 'assessores' não precisa filtrar aqui, pois depois filtramos por supervisorId em cada grupo
    }

    // Se for ANALISTA: mostra só os buckets desse analista
    if (me?.papel === 'analista') {
      analistas = analistas.filter(a => a.id === me.id);
      assessores = assessores.filter(a => (a.analistaId ?? null) === me.id);
    }

    const mapAnalista = new Map(analistas.map(a => [a.id, a]));

    // === grupos por supervisor ===
    let grupos: GrupoSupervisor[] = supervisores.map(s => {
      // assessores deste supervisor (já filtrados pela busca e, se analista, pela analistaId)
      const assDoSup = assessores.filter(a => (a.supervisorId ?? null) === s.id);

      // agrupar por analista
      const mapBuckets = new Map<string, Colaborador[]>();
      const semAnalista: Colaborador[] = [];

      for (const a of assDoSup) {
        const aid = a.analistaId ?? '';
        if (!aid) { semAnalista.push(a); continue; }
        if (!mapBuckets.has(aid)) mapBuckets.set(aid, []);
        mapBuckets.get(aid)!.push(a);
      }

      const buckets: Bucket[] = Array.from(mapBuckets.entries())
        .map(([aid, list]) => {
          const analista = mapAnalista.get(aid) ?? null;
          const equipeId = this.equipeId(s.id, aid);
          const equipeNome = this.equipesMap.get(equipeId)?.nome ?? '';
          return {
            analista,
            assessores: list.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome))),
            equipeId,
            equipeNome
          };
        })
        .sort((b1, b2) =>
          nrm(b1.analista?.nome || 'Sem analista')
            .localeCompare(nrm(b2.analista?.nome || 'Sem analista'))
        );

      return {
        supervisor: s,
        buckets,
        // se usuário é analista, 'semAnalista' já cai pra 0 porque filtramos assessores por analistaId lá em cima
        semAnalista: semAnalista.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome)))
      };
    });

    // Remove supervisores que ficaram totalmente vazios para o analista/supervisor
    grupos = grupos.filter(g => g.buckets.length || g.semAnalista.length);

    // === Assessores sem supervisor (global), agrupados por analista ===
    let assSemSup = assessores.filter(a => !a.supervisorId);

    // Se for supervisor, não faz sentido mostrar card "sem supervisor" (não é time dele)
    if (me?.papel === 'supervisor') {
      assSemSup = [];
    }

    const mapSemSup = new Map<string, Colaborador[]>();
    for (const a of assSemSup) {
      const aid = a.analistaId ?? '';
      if (!mapSemSup.has(aid)) mapSemSup.set(aid, []);
      mapSemSup.get(aid)!.push(a);
    }

    const semSupervisor: Bucket[] = Array.from(mapSemSup.entries())
      .map(([aid, list]) => {
        const analista = aid ? (mapAnalista.get(aid) ?? null) : null;
        return {
          analista,
          assessores: list.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome))),
          equipeId: this.equipeId('', aid),
          equipeNome: ''
        };
      })
      .sort((b1, b2) =>
        nrm(b1.analista?.nome || 'Sem analista')
          .localeCompare(nrm(b2.analista?.nome || 'Sem analista'))
      );

    this.grupos.set(grupos);
    this.bucketsSemSupervisor.set(semSupervisor);
  }

  public onBuscaChange() {
    this.montarArvore();
  }

  public nomeCurto(nome: string | undefined | null): string {
    const n = (nome || '').trim();
    if (!n) return '';
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  public cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  // ===== Compat/Selectors pro template =====
  public porSupervisor(): GrupoSupervisor[] { return this.grupos(); }
  public semSupervisor(): Bucket[] { return this.bucketsSemSupervisor(); }

  // ===== Resumo do time visível =====
  public resumoSupervisores(): number {
    return this.grupos().length;
  }

  public resumoAnalistas(): number {
    const ids = new Set<string>();
    for (const g of this.grupos()) {
      for (const b of g.buckets) {
        if (b.analista?.id) {
          ids.add(b.analista.id);
        }
      }
    }
    for (const b of this.bucketsSemSupervisor()) {
      if (b.analista?.id) {
        ids.add(b.analista.id);
      }
    }
    return ids.size;
  }

  public resumoAssessores(): number {
    let tot = 0;
    for (const g of this.grupos()) {
      for (const b of g.buckets) tot += b.assessores.length;
      tot += g.semAnalista.length;
    }
    for (const b of this.bucketsSemSupervisor()) {
      tot += b.assessores.length;
    }
    return tot;
  }

  public totalAssessoresDoGrupo(g: GrupoSupervisor): number {
    let tot = g.semAnalista.length;
    for (const b of g.buckets) tot += b.assessores.length;
    return tot;
  }

  public totalAssessoresSemSup(): number {
    let tot = 0;
    for (const b of this.bucketsSemSupervisor()) tot += b.assessores.length;
    return tot;
  }

  // ===== Nome do time (equipe) =====
  private equipeId(supervisorId: string, analistaId: string): string {
    return `${supervisorId || 'nosup'}__${analistaId || ''}`;
  }

  public startEditEquipe(b: Bucket, supId: string) {
    this.editEquipeId = b.equipeId;
    this.editEquipeNome = b.equipeNome || '';
  }

  public cancelEditEquipe() {
    this.editEquipeId = null;
    this.editEquipeNome = '';
  }

  public async salvarEquipeNome(b: Bucket, supId: string) {
    const nome = (this.editEquipeNome || '').trim();
    const [supervisorId, analistaIdRaw] = b.equipeId.split('__');
    const analistaId = analistaIdRaw || null;

    try {
      await setDoc(doc(db, 'equipes', b.equipeId), {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      }, { merge: true });

      // refletir na UI imediatamente
      this.equipesMap.set(b.equipeId, {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      });
      this.montarArvore();
      this.cancelEditEquipe();
    } catch (e) {
      console.error(e);
      this.erro.set('Falha ao salvar o nome do time.');
    }
  }

  // ===== Helpers =====
  private filtrarBusca(items: Colaborador[]): Colaborador[] {
    const term = (this.busca || '').trim().toLowerCase();
    if (!term) return items;
    return items.filter(c => {
      const blob = `${c.nome} ${c.email}`.toLowerCase();
      return blob.includes(term);
    });
  }

  // ===== Modal de resumo por assessor =====
  public abrirResumoAssessor(a: Colaborador) {
    this.resumoAssessor = a;

    // tenta por id do doc, se não achar tenta por uid
    const lista =
      this.prePorAssessor.get(a.id) ||
      (a.uid ? this.prePorAssessor.get(a.uid) : null) ||
      [];

    this.montarResumoAssessor(lista);
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
    this.showResumoModal = true;
  }

  public fecharResumoModal() {
    this.showResumoModal = false;
    this.resumoAssessor = null;
    this.resumoStats = null;
    this.listaSelecionada = [];
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
  }

  private montarResumoAssessor(lista: PreCadastroResumo[]) {
    const meUid = this.currentUserUid;

    const encaminhadosPorMim = meUid
      ? lista.filter(p => p.encaminhadoPorUid === meUid)
      : [];

    const formalizados = lista.filter(
      p => p.formalizacao?.status === 'formalizado'
    );

    const desistencias = lista.filter(
      p => p.desistencia?.status === 'desistiu'
    );

    this.resumoStats = {
      encaminhadosPorMim: encaminhadosPorMim.length,
      total: lista.length,
      formalizados: formalizados.length,
      desistencias: desistencias.length
    };

    this.listasPorCategoria = {
      encaminhadosPorMim,
      total: lista,
      formalizados,
      desistencias
    };

    // visão inicial em cards
    this.listaSelecionada = [];
    this.viewResumoMode = 'cards';
  }

  public abrirDetalheCategoria(cat: CategoriaResumo) {
    this.categoriaSelecionada = cat;
    this.listaSelecionada = this.listasPorCategoria[cat] || [];
    this.categoriaLabelSelecionada = this.labelCategoria(cat);
    this.viewResumoMode = 'lista';
  }

  public voltarParaResumoCards() {
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
    this.listaSelecionada = [];
  }

  private labelCategoria(cat: CategoriaResumo): string {
    switch (cat) {
      case 'encaminhadosPorMim':
        return 'Encaminhados por mim';
      case 'total':
        return 'Pré-cadastros totais';
      case 'formalizados':
        return 'Formalizados';
      case 'desistencias':
        return 'Desistências';
      default:
        return '';
    }
  }
}
