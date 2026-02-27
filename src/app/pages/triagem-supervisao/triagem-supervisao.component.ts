import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HeaderComponent } from '../shared/header/header.component';

import { PreCadastroService } from '../../services/pre-cadastro.service';
import { GrupoSolidarioService } from '../../services/grupo-solidario.service';

import { PreCadastro } from '../../models/pre-cadastro.model';
import { GrupoSolidario, MembroGrupoView } from '../../models/grupo-solidario.model';

import { Auth, user } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query as fsQuery,
  where,
  limit,
  setDoc,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

type Aba = 'pessoas' | 'grupos';

type FiltroEnvio = 'todos' | 'encaminhado' | 'nao_encaminhado' | 'apto' | 'inapto';


type Assessor = {
  uid: string;
  nome: string;
  email?: string | null;
  rota?: string | null;
  analistaId?: string | null;
};

type Analista = { uid: string; nome: string };

@Component({
  selector: 'app-triagem-supervisao',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './triagem-supervisao.component.html',
  styleUrls: ['./triagem-supervisao.component.css'],
})
export class TriagemSupervisaoComponent implements OnInit, OnDestroy {
  // ====== injeções ======
  private preSvc = inject(PreCadastroService);
  private gruposSvc = inject(GrupoSolidarioService);
  private auth = inject(Auth);
  private afs = inject(Firestore);

  // ====== estado usuário atual ======
  currentUserUid: string | null = null;
  currentUserNome: string | null = null;
  private subUser?: Subscription;

  // cache de nomes para não ficar lendo o mesmo colaborador sempre
  private nomeCache = new Map<string, string>();

  // UIDs dos Analistas vinculados ao Supervisor (extraídos do analistaId dos assessores)
  private analistasUids: string[] = [];

  // ====== abas / UI básica ======
  loading = false;
  aba: Aba = 'pessoas';

  searchTerm = '';
  filtroEnvio: FiltroEnvio = 'todos';

  filtroAssessor: string | 'todos' = 'todos';

  // ====== filtro por analista do time ======
  analistas: Analista[] = [];
  filtroAnalista: string | 'todos' = 'todos';


  // ====== pessoas ======
  pessoas: PreCadastro[] = [];      // base completa (caixa + encaminhados + membros de grupos)
  pessoasView: PreCadastro[] = [];  // filtradas pela busca/filtros

  // ====== grupos ======
  grupos: GrupoSolidario[] = [];       // grupos da lista
  gruposView: GrupoSolidario[] = [];   // filtrados pela busca

  // ====== assessores (time do analista) ======
  assessores: Assessor[] = [];
  assessoresFiltrados: Assessor[] = [];

  // ====== modal encaminhar PESSOA ======
  showAssessorPessoaModal = false;
  pessoaSelecionada: PreCadastro | null = null;
  selectedAssessorUidPessoa: string | null = null;
  buscaAssessorPessoa = '';

  // ====== modal encaminhar GRUPO ======
  showAssessorGrupoModal = false;
  grupoSelecionado: GrupoSolidario | null = null;
  selectedAssessorUidGrupo: string | null = null;
  buscaAssessorGrupo = '';

  // ====== modal DETALHE GRUPO ======
  showGrupoDetalhe = false;
  grupoDetalhe: GrupoSolidario | null = null;

  // ====================================================
  // CICLO DE VIDA
  // ====================================================
  ngOnInit(): void {
    this.subUser = user(this.auth).subscribe(async (u) => {
      this.loading = true;
      try {
        if (!u) {
          this.currentUserUid = null;
          this.currentUserNome = null;
          this.resetarListas();
          return;
        }

        this.currentUserUid = u.uid;
        this.currentUserNome = await this.resolveUserName(u.uid);

        // Descobre o time primeiro para passar os UIDs completos ao carregamento de assessores
        const equipeUids = await this.obterIdsDoMeuTime();
        await this.carregarAssessoresDoMeuTime(equipeUids);

        await this.carregarPessoasDoAnalista(equipeUids);
        await this.carregarGruposDoAnalista(equipeUids);
        await this.mesclarPreCadastrosDeGrupos(); // garante membros de grupos na aba Pessoas

        this.aplicarFiltrosPessoas();
        this.aplicarFiltrosGrupos();
      } catch (e) {
        console.error('[TriagemSupervisao] erro ao iniciar:', e);
        this.resetarListas();
      } finally {
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subUser?.unsubscribe();
  }

  private resetarListas() {
    this.pessoas = [];
    this.pessoasView = [];
    this.grupos = [];
    this.gruposView = [];
    this.assessores = [];
    this.assessoresFiltrados = [];
    this.analistas = [];
    this.filtroAnalista = 'todos';
  }

  setAssessorFilter(uid: string | 'todos') {
    this.filtroAssessor = uid;
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
  }

  setAnalistaFilter(uid: string | 'todos') {
    this.filtroAnalista = uid;
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
  }


  // ====================================================
  // RESOLVE NOME DO USUÁRIO (igual módulo Lista)
  // ====================================================
  private async resolveUserName(uid: string): Promise<string> {
    if (this.nomeCache.has(uid)) return this.nomeCache.get(uid)!;

    let nome: string | null = null;

    try {
      const snap = await getDoc(doc(this.afs, 'colaboradores', uid));
      if (snap.exists()) {
        const data: any = snap.data();
        if (data?.nome) nome = String(data.nome);
      }
    } catch (e) {
      console.warn('[NomePerfil] doc direto falhou:', e);
    }

    if (!nome) {
      try {
        const q = fsQuery(
          collection(this.afs, 'colaboradores'),
          where('uid', '==', uid),
          limit(1)
        );
        const qs = await getDocs(q);
        qs.forEach((d) => {
          const data: any = d.data();
          if (!nome && data?.nome) nome = String(data.nome);
        });
      } catch (e) {
        console.warn('[NomePerfil] query por uid falhou:', e);
      }
    }

    if (!nome) nome = this.auth.currentUser?.displayName || null;

    if (!nome) {
      const email = this.auth.currentUser?.email || '';
      if (email) {
        const local = email.split('@')[0].replace(/[._-]+/g, ' ');
        nome = local.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    if (!nome) nome = 'Usuário';

    this.nomeCache.set(uid, nome);
    return nome;
  }

  // ====================================================
  // DESCOBERTA DE TIME: [supervisorUid, ...analistasIds]
  // Busca dupla em paralelo:
  //  A) Analistas com supervisorId == eu no próprio perfil (ligação direta)
  //  B) Analistas inferidos pelo analistaId dos assessores vinculados ao supervisor
  // ====================================================
  private async obterIdsDoMeuTime(): Promise<string[]> {
    if (!this.currentUserUid) return [];
    try {
      const ref = collection(this.afs, 'colaboradores');

      // Busca A: analistas que têm supervisorId apontando para mim diretamente
      const qAnalistaDireto = fsQuery(
        ref,
        where('status', '==', 'ativo'),
        where('papel', '==', 'analista'),
        where('supervisorId', '==', this.currentUserUid)
      );

      // Busca B: assessores cujo supervisorId é meu → extrair analistaId deles
      const qAssessorDoSupervisor = fsQuery(
        ref,
        where('status', '==', 'ativo'),
        where('papel', '==', 'assessor'),
        where('supervisorId', '==', this.currentUserUid)
      );

      const [snapAnalistas, snapAssessores] = await Promise.all([
        getDocs(qAnalistaDireto),
        getDocs(qAssessorDoSupervisor),
      ]);

      const analistaIdsSet = new Set<string>();

      // Resultado A: UIDs diretos dos analistas
      snapAnalistas.docs.forEach(d => analistaIdsSet.add(d.id));

      // Resultado B: analistaId de cada assessor
      snapAssessores.docs.forEach(d => {
        const a = d.data() as any;
        if (a?.analistaId) analistaIdsSet.add(a.analistaId);
      });

      this.analistasUids = Array.from(analistaIdsSet);

      // Resolve os nomes dos analistas para exibir no filtro visual
      this.analistas = await Promise.all(
        this.analistasUids.map(async uid => ({
          uid,
          nome: await this.resolveUserName(uid),
        }))
      );

      return [this.currentUserUid, ...this.analistasUids];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao obter IDs do time:', e);
      return [this.currentUserUid];
    }
  }

  // ====================================================
  // CARREGAR ASSESSORES DO MEU TIME
  // ====================================================
  private async carregarAssessoresDoMeuTime(teamUids: string[]): Promise<void> {
    try {
      const uids = [...new Set(teamUids)].filter(Boolean);
      if (!uids.length) {
        this.assessores = [];
        this.assessoresFiltrados = [];
        return;
      }

      const ref = collection(this.afs, 'colaboradores');
      const map = new Map<string, Assessor>();

      const pushDoc = (d: any) => {
        const data = d.data() as any;
        map.set(d.id, {
          uid: d.id,
          nome: data?.nome || data?.displayName || data?.email || 'Assessor',
          email: data?.email || null,
          rota: data?.rota || null,
          analistaId: data?.analistaId || null,
        });
      };

      // Chunking para Firestore 'in' (máx 10 valores por query)
      const chunks: string[][] = [];
      for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

      for (const chunk of chunks) {
        const inSup = chunk.length === 1
          ? where('supervisorId', '==', chunk[0])
          : where('supervisorId', 'in', chunk);
        const inAna = chunk.length === 1
          ? where('analistaId', '==', chunk[0])
          : where('analistaId', 'in', chunk);

        const [supSnap, anaSnap] = await Promise.all([
          getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'), inSup)),
          getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'), inAna)),
        ]);

        supSnap.docs.forEach(pushDoc);
        anaSnap.docs.forEach(pushDoc);
      }

      this.assessores = Array.from(map.values()).sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '')
      );
      this.assessoresFiltrados = [...this.assessores];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar assessores:', e);
      this.assessores = [];
      this.assessoresFiltrados = [];
    }
  }

  // ====================================================
  // CARREGAR PESSOAS DO ANALISTA
  // (igual lógica do módulo Lista: caixa + encaminhadosPorMim)
  // ====================================================
  private normalize(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private toJSDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      try {
        return v.toDate();
      } catch {
        return null;
      }
    }
    return null;
  }

  private async carregarPessoasDoAnalista(uid: string | string[]): Promise<void> {
    try {
      // listarParaCaixa busca por caixaUid (onde o Admin deposita o lead)
      // e encaminhamento.assessorUid — cobre todos os cenários de distribuição
      const base = await this.preSvc.listarParaCaixa(uid);

      // encaminhadosPorUid: cobre todos os UIDs do time (supervisor + analistas)
      const encaminhados = await this.buscarPreCadastrosEncaminhadosPor(uid);

      const mapRows = new Map<string, PreCadastro>();

      for (const r of base || []) {
        if (r?.id) mapRows.set(r.id, r);
      }
      for (const e of encaminhados || []) {
        if (!e?.id) continue;
        const atual = mapRows.get(e.id);
        mapRows.set(e.id, { ...(atual as any), ...(e as any) } as PreCadastro);
      }

      const merged = Array.from(mapRows.values());

      const norm = merged.map((r) => {
        const formalizacao = (r as any).formalizacao || {};
        const desistencia = (r as any).desistencia || {};

        const rawGrupo: any = (r as any).grupo || null;
        const grupoId =
          (r as any).grupoId ??
          (r as any).grupoSolidarioId ??
          rawGrupo?.id ??
          null;
        const grupoNome =
          (r as any).grupoNome ??
          rawGrupo?.nome ??
          null;
        const papelNoGrupo =
          (r as any).papelNoGrupo ??
          (r as any).grupoPapel ??
          rawGrupo?.papel ??
          null;

        return {
          ...r,
          agendamentoStatus: (r as any).agendamentoStatus || 'nao_agendado',
          grupoId,
          grupoNome,
          papelNoGrupo,
          formalizacao: {
            status: (formalizacao.status as any) || 'nao_formalizado',
            porUid: formalizacao.porUid,
            porNome: formalizacao.porNome,
            em: formalizacao.em,
            observacao: formalizacao.observacao ?? null,
          },
          desistencia: {
            status: (desistencia.status as any) || 'nao_desistiu',
            porUid: desistencia.porUid,
            porNome: desistencia.porNome,
            em: desistencia.em,
            observacao: desistencia.observacao ?? null,
          },
        } as PreCadastro;
      });

      this.pessoas = norm;
      this.pessoasView = [...this.pessoas];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar pessoas:', e);
      this.pessoas = [];
      this.pessoasView = [];
    }
  }

  // =========== busca extra: pré-cadastros encaminhados por qualquer membro do time ===========
  private async buscarPreCadastrosEncaminhadosPor(
    uid: string | string[]
  ): Promise<PreCadastro[]> {
    const uids = [...new Set(Array.isArray(uid) ? uid : [uid])].filter(Boolean);
    if (!uids.length) return [];
    try {
      const ref = collection(this.afs, 'pre_cadastros');
      const lista: PreCadastro[] = [];

      // Chunking para o operador 'in' do Firestore (máx 10 por query)
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        const q = chunk.length === 1
          ? fsQuery(ref, where('encaminhadoPorUid', '==', chunk[0]))
          : fsQuery(ref, where('encaminhadoPorUid', 'in', chunk));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          lista.push({ id: docSnap.id, ...docSnap.data() } as PreCadastro);
        });
      }

      return lista;
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar pre_cadastros encaminhados:', e);
      return [];
    }
  }

  // ====================================================
  // CARREGAR GRUPOS DO ANALISTA
  // (igual Lista: caixa + grupos encaminhados por mim + joinGruposView)
  // ====================================================
  // =========== busca extra: grupos encaminhados por qualquer membro do time ===========
  private async buscarGruposEncaminhadosPor(
    uid: string | string[]
  ): Promise<GrupoSolidario[]> {
    const uids = [...new Set(Array.isArray(uid) ? uid : [uid])].filter(Boolean);
    if (!uids.length) return [];
    try {
      const ref = collection(this.afs, 'grupos_solidarios');
      const lista: GrupoSolidario[] = [];

      // Chunking para o operador 'in' do Firestore (máx 10 por query)
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        const q = chunk.length === 1
          ? fsQuery(ref, where('encaminhadoPorUid', '==', chunk[0]))
          : fsQuery(ref, where('encaminhadoPorUid', 'in', chunk));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          lista.push({ id: docSnap.id, ...docSnap.data() } as GrupoSolidario);
        });
      }

      return lista;
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar grupos encaminhados:', e);
      return [];
    }
  }

  private async carregarGruposDoAnalista(uid: string | string[]): Promise<void> {
    try {
      const base = await this.gruposSvc.listarParaCaixaAssessor(uid);
      // encaminhadosPorUid: cobre todos os UIDs do time (supervisor + analistas)
      const encaminhadosPorMim = await this.buscarGruposEncaminhadosPor(uid);

      const map = new Map<string, GrupoSolidario>();

      for (const g of base || []) {
        const id = (g as any).id;
        if (!id) continue;
        map.set(id, g);
      }

      for (const g of encaminhadosPorMim || []) {
        const id = (g as any).id;
        if (!id) continue;
        const atual = map.get(id);
        map.set(id, { ...(atual as any), ...(g as any) } as GrupoSolidario);
      }

      const merged = Array.from(map.values());

      // join para coordenadorView, membrosView etc. (igual Lista)
      const join = await this.gruposSvc.joinGruposView(merged);
      this.grupos = join || [];
      this.gruposView = [...this.grupos];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar grupos:', e);
      this.grupos = [];
      this.gruposView = [];
    }
  }


  // ====================================================
  // Mesclar pré-cadastros de GRUPOS na aba PESSOAS
  // (cópia da lógica do módulo Lista, adaptada aqui)
  // ====================================================
  private async mesclarPreCadastrosDeGrupos() {
    try {
      const atuais = new Map<string, PreCadastro>();
      for (const p of this.pessoas) {
        if (p?.id) atuais.set(p.id, p);
      }

      const grupos = this.grupos || [];
      const faltando = new Map<
        string,
        { grupoId: string; grupoNome: string | null }
      >();

      for (const g of grupos) {
        const gid = (g as any).id;
        const gnome = (g as any).nome || null;
        const membrosIds: string[] = ((g as any).membrosIds || []) as string[];

        if (!gid || !membrosIds?.length) continue;

        for (const preId of membrosIds) {
          if (!preId) continue;

          if (atuais.has(preId)) {
            const cur = atuais.get(preId)!;
            atuais.set(preId, {
              ...(cur as any),
              grupoId: gid,
              grupoNome: gnome,
              papelNoGrupo: (cur as any).papelNoGrupo ?? 'membro',
            } as PreCadastro);
          } else {
            if (!faltando.has(preId)) {
              faltando.set(preId, { grupoId: gid, grupoNome: gnome });
            }
          }
        }

        // coordenadorView também entra como pessoa
        const coord: any = (g as any).coordenadorView || null;
        if (coord?.preCadastroId) {
          const preId = coord.preCadastroId;
          if (atuais.has(preId)) {
            const cur = atuais.get(preId)!;
            atuais.set(preId, {
              ...(cur as any),
              grupoId: gid,
              grupoNome: gnome,
              papelNoGrupo: (cur as any).papelNoGrupo ?? 'coordenador',
            } as PreCadastro);
          } else {
            if (!faltando.has(preId)) {
              faltando.set(preId, { grupoId: gid, grupoNome: gnome });
            }
          }
        }
      }

      // busca no Firestore os pré-cadastros que não estavam em this.pessoas
      for (const [preId, info] of faltando.entries()) {
        try {
          const snap = await getDoc(doc(this.afs, 'pre_cadastros', preId));
          if (!snap.exists()) {
            console.warn(
              '[Grupos->Pessoas] pre_cadastro não encontrado para membroId =',
              preId
            );
            continue;
          }

          const data = snap.data() as any;

          const pre: PreCadastro = {
            id: preId,
            nomeCompleto: (data.nomeCompleto ?? data.nome ?? null) as any,
            cpf: (data.cpf ?? null) as any,
            telefone: (data.telefone ?? null) as any,
            email: (data.email ?? null) as any,
            endereco: (data.endereco ?? null) as any,
            bairro: (data.bairro ?? null) as any,
            cidade: (data.cidade ?? null) as any,
            uf: (data.uf ?? null) as any,
            agendamentoStatus: (data.agendamentoStatus || 'nao_agendado') as any,
            formalizacao: data.formalizacao,
            desistencia: data.desistencia,
            grupoId: info.grupoId,
            grupoNome: info.grupoNome,
            papelNoGrupo: 'membro',
            ...data,
          } as PreCadastro;

          atuais.set(preId, pre);
        } catch (e) {
          console.error(
            '[Grupos->Pessoas] erro ao buscar pre_cadastro',
            preId,
            e
          );
        }
      }

      this.pessoas = Array.from(atuais.values());
      this.pessoasView = [...this.pessoas];
    } catch (e) {
      console.error(
        '[Grupos->Pessoas] erro geral ao mesclar membrosIds em TriagemSupervisao:',
        e
      );
    }
  }

  // ====================================================
  // FILTROS / BUSCA
  // ====================================================
  setAba(aba: Aba) {
    this.aba = aba;
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
  }

  onSearchChange() {
    if (this.aba === 'pessoas') this.aplicarFiltrosPessoas();
    else this.aplicarFiltrosGrupos();
  }

  setEnvioFilter(f: FiltroEnvio) {
    //this.filtroEnvio = f;
    if (this.filtroEnvio === f) {
      this.filtroEnvio = 'todos';
    } else {
      this.filtroEnvio = f;
    }
      this.aplicarFiltrosPessoas();
  }

  private aplicarFiltrosPessoas() {
    let list = [...this.pessoas];

    // filtro encaminhamento
    // if (this.filtroEnvio !== 'todos') {
    //   list = list.filter((p) => {
    //     const enc = !!(p as any).encaminhadoParaUid;
    //     return this.filtroEnvio === 'encaminhado' ? enc : !enc;
    //   });
    // }

    if (this.filtroEnvio !== 'todos') {
      // 🔵 FILTROS DE ENCAMINHAMENTO
      if (this.filtroEnvio === 'encaminhado' || this.filtroEnvio === 'nao_encaminhado') {
        list = list.filter((p) => {
          const enc = !!(p as any).encaminhadoParaUid;
          return this.filtroEnvio === 'encaminhado' ? enc : !enc;
        });
      }
      // 🟢 FILTROS DE APROVAÇÃO
      if (this.filtroEnvio === 'apto' || this.filtroEnvio === 'inapto') {

        list = list.filter((p) => {
          const status = (p as any).aprovacao?.status || 'nao_verificado';
          return status === this.filtroEnvio;
        });
      }
    }


    // filtro por analista do time (leads na caixa do analista ou encaminhados por ele)
    if (this.filtroAnalista !== 'todos') {
      list = list.filter((p) =>
        (p as any).caixaUid === this.filtroAnalista ||
        (p as any).encaminhadoPorUid === this.filtroAnalista
      );
    }

    // filtro por assessor — verifica todos os campos onde o UID do destinatário pode estar
    if (this.filtroAssessor !== 'todos') {
      list = list.filter((p) => {
        const pAny = p as any;
        return pAny.encaminhadoParaUid          === this.filtroAssessor ||
               pAny.designadoParaUid            === this.filtroAssessor ||
               pAny.caixaUid                   === this.filtroAssessor ||
               pAny.encaminhamento?.assessorUid === this.filtroAssessor;
      });
    }

    const term = this.normalize(this.searchTerm);
    if (term === 'apto' || term === 'inapto' || term === 'nao_verificado') {
      list = list.filter((p) => {
        const status = (p as any).aprovacao?.status || 'nao_verificado';
        return status === term;
      });

    } else if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${(p as any).nomeCompleto || (p as any).nome || ''} ${(p as any).cpf || ''
          } ${(p as any).telefone || ''} ${(p as any).email || ''} ${(p as any).bairro || ''
          } ${(p as any).cidade || ''} ${(p as any).uf || ''} ${(p as any).grupoNome || ''
          } ${(p as any).aprovacao?.status || ''} ${(p as any).createdByNome || ''} ${(p as any).modalidade || ''} ${(p as any).sexo || ''}`
        );
        return blob.includes(term);
      });
    }

    list.sort((a, b) => {
      const da = this.toJSDate((a as any).createdAt)?.getTime() || 0;
      const db = this.toJSDate((b as any).createdAt)?.getTime() || 0;
      return db - da;
    });

    this.pessoasView = list;
  }

  private aplicarFiltrosGrupos() {
    let list = [...this.grupos];

    // filtro por analista do time (grupos na caixa do analista ou encaminhados por ele)
    if (this.filtroAnalista !== 'todos') {
      list = list.filter((g) =>
        (g as any).caixaUid === this.filtroAnalista ||
        (g as any).encaminhadoPorUid === this.filtroAnalista
      );
    }

    // filtro por assessor — verifica todos os campos onde o UID do destinatário pode estar
    if (this.filtroAssessor !== 'todos') {
      list = list.filter((g) => {
        const gAny = g as any;
        return gAny.encaminhadoParaUid === this.filtroAssessor ||
               gAny.designadoParaUid   === this.filtroAssessor ||
               gAny.caixaUid           === this.filtroAssessor;
      });
    }

    const term = this.normalize(this.searchTerm);
    if (term) {
      list = list.filter((g) => {
        const coord: any = (g as any).coordenadorView || {};
        const blob = this.normalize(
          `${(g as any).nome || ''} ${(g as any).codigo || ''} ${coord?.nome || ''
          } ${(g as any).cidade || ''} ${(g as any).estado || ''}
          ${(g as any).aprovacao || ''}`
        );
        return blob.includes(term);
      });
    }

    this.gruposView = list;
  }

  // ====================================================
  // UTILS VISUAIS
  // ====================================================
  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  whatsHref(v?: string | null): string | null {
    if (!v) return null;
    let d = String(v).replace(/\D+/g, '');
    if (d.startsWith('55')) d = d.slice(2);
    d = d.replace(/^0+/, '');
    if (d.length < 10 || d.length > 11) return null;
    return `https://wa.me/55${d}`;
  }

  encaminhadoNome(p: PreCadastro): string | null {
    return (
      (p as any).encaminhadoParaNome ||
      (p as any).encaminhamento?.assessorNome ||
      null
    );
  }

  encaminhadoData(p: PreCadastro): string | null {
    const rawEm = (p as any).encaminhadoEm ?? (p as any).designadoEm ?? null;
    const d = this.toJSDate(rawEm);
    if (!d) return null;
    const dd  = String(d.getDate()).padStart(2, '0');
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const hh  = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} às ${hh}:${min}`;
  }

  // Mantido para o *ngIf do badge "Encaminhado / Não encaminhado"
  encaminhadoLabel(p: PreCadastro): string | null {
    return this.encaminhadoNome(p);
  }

  getStatusClass(status?: string): string {
    switch ((status || '').toLowerCase()) {
      case 'apto':        return 'bg-success';
      case 'inapto':      return 'bg-danger';
      case 'nao_verificado': return 'bg-secondary';
      default:            return 'bg-secondary';
    }
  }

  // ====================================================
  // MODAL — ENC. PESSOA
  // ====================================================
  abrirModalAssessorPessoa(p: PreCadastro) {
    if (!this.assessores.length) {
      alert('Não há assessores vinculados ao seu time.');
      return;
    }
    this.pessoaSelecionada = p;
    this.selectedAssessorUidPessoa =
      ((p as any).encaminhadoParaUid as string) ||
      ((p as any).designadoParaUid as string) ||
      null;
    this.buscaAssessorPessoa = '';
    this.assessoresFiltrados = [...this.assessores];
    this.showAssessorPessoaModal = true;
  }

  fecharModalAssessorPessoa() {
    this.showAssessorPessoaModal = false;
    this.pessoaSelecionada = null;
    this.selectedAssessorUidPessoa = null;
    this.buscaAssessorPessoa = '';
  }

  filtrarAssessoresPessoa() {
    const term = this.normalize(this.buscaAssessorPessoa);
    if (!term) {
      this.assessoresFiltrados = [...this.assessores];
      return;
    }
    this.assessoresFiltrados = this.assessores.filter((a) =>
      this
        .normalize(`${a.nome || ''} ${a.email || ''} ${a.rota || ''}`)
        .includes(term)
    );
  }

  async confirmarEncaminharPessoa() {
    if (!this.pessoaSelecionada || !this.selectedAssessorUidPessoa) return;
    await this.encaminharPreCadastro(
      this.pessoaSelecionada,
      this.selectedAssessorUidPessoa
    );
    this.fecharModalAssessorPessoa();
  }

  private async encaminharPreCadastro(
    pre: PreCadastro,
    assessorUid: string
  ): Promise<void> {
    if (!pre?.id) return;

    try {
      const colabRef = doc(this.afs, 'colaboradores', assessorUid);
      const colabSnap = await getDoc(colabRef);
      const colabData: any = colabSnap.data() || {};
      const assessorNome =
        colabData?.nome || colabData?.displayName || colabData?.email || null;

      const meUid = this.currentUserUid;
      const meNome = this.currentUserNome;

      const ref = doc(this.afs, 'pre_cadastros', pre.id);
      await setDoc(
        ref,
        {
          designadoParaUid: assessorUid,
          designadoPara: assessorUid,
          designadoParaNome: assessorNome,
          designadoEm: serverTimestamp(),

          encaminhadoParaUid: assessorUid,
          encaminhadoParaNome: assessorNome,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome ?? null,

          caixaAtual: 'assessor',
          caixaUid: assessorUid,
        },
        { merge: true }
      );

      const patch: any = {
        designadoParaUid: assessorUid,
        designadoParaNome: assessorNome,
        encaminhadoParaUid: assessorUid,
        encaminhadoParaNome: assessorNome,
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome ?? null,
        caixaAtual: 'assessor',
        caixaUid: assessorUid,
      };

      this.pessoas = this.pessoas.map((p) =>
        p.id === pre.id ? ({ ...(p as any), ...patch } as PreCadastro) : p
      );
      this.aplicarFiltrosPessoas();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao encaminhar pessoa:', e);
      alert('Não foi possível encaminhar o pré-cadastro. Tente novamente.');
    }
  }

  // ====================================================
  // MODAL — ENC. GRUPO
  // ====================================================
  abrirModalAssessorGrupo(g: GrupoSolidario) {
    if (!this.assessores.length) {
      alert('Não há assessores vinculados ao seu time.');
      return;
    }
    this.grupoSelecionado = g;
    this.selectedAssessorUidGrupo =
      ((g as any).encaminhadoParaUid as string) ||
      ((g as any).designadoParaUid as string) ||
      null;
    this.buscaAssessorGrupo = '';
    this.assessoresFiltrados = [...this.assessores];
    this.showAssessorGrupoModal = true;
  }

  fecharModalAssessorGrupo() {
    this.showAssessorGrupoModal = false;
    this.grupoSelecionado = null;
    this.selectedAssessorUidGrupo = null;
    this.buscaAssessorGrupo = '';
  }

  filtrarAssessoresGrupo() {
    const term = this.normalize(this.buscaAssessorGrupo);
    if (!term) {
      this.assessoresFiltrados = [...this.assessores];
      return;
    }
    this.assessoresFiltrados = this.assessores.filter((a) =>
      this
        .normalize(`${a.nome || ''} ${a.email || ''} ${a.rota || ''}`)
        .includes(term)
    );
  }

  async confirmarEncaminharGrupo() {
    if (!this.grupoSelecionado || !this.selectedAssessorUidGrupo) return;
    await this.encaminharGrupo(
      this.grupoSelecionado,
      this.selectedAssessorUidGrupo
    );
    this.fecharModalAssessorGrupo();
  }

  private async encaminharGrupo(
    g: GrupoSolidario,
    assessorUid: string
  ): Promise<void> {
    const gid = (g as any).id;
    if (!gid) return;

    try {
      const colabRef = doc(this.afs, 'colaboradores', assessorUid);
      const colabSnap = await getDoc(colabRef);
      const colabData: any = colabSnap.data() || {};
      const assessorNome =
        colabData?.nome || colabData?.displayName || colabData?.email || null;

      const meUid = this.currentUserUid;
      const meNome = this.currentUserNome;

      const batch = writeBatch(this.afs);

      // grupo
      const refGrupo = doc(this.afs, 'grupos_solidarios', gid);
      batch.set(
        refGrupo,
        {
          designadoParaUid: assessorUid,
          designadoParaNome: assessorNome,
          designadoEm: serverTimestamp(),

          encaminhadoParaUid: assessorUid,
          encaminhadoParaNome: assessorNome,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome ?? null,

          caixaAtual: 'assessor',
          caixaUid: assessorUid,
        },
        { merge: true }
      );

      // coordenador + membros (usando joinGruposView: coordenadorView / membrosView)
      const coord: any = (g as any).coordenadorView || null;
      const membros: any[] = ((g as any).membrosView || []) as MembroGrupoView[];

      const ids = new Set<string>();
      if (coord?.preCadastroId) ids.add(coord.preCadastroId);
      for (const m of membros) {
        if (m?.preCadastroId) ids.add(m.preCadastroId);
      }

      ids.forEach((id) => {
        const refPre = doc(this.afs, 'pre_cadastros', id);
        batch.set(
          refPre,
          {
            designadoParaUid: assessorUid,
            designadoPara: assessorUid,
            designadoParaNome: assessorNome,
            designadoEm: serverTimestamp(),

            encaminhadoParaUid: assessorUid,
            encaminhadoParaNome: assessorNome,
            encaminhadoEm: serverTimestamp(),
            encaminhadoPorUid: meUid,
            encaminhadoPorNome: meNome ?? null,

            caixaAtual: 'assessor',
            caixaUid: assessorUid,
          },
          { merge: true }
        );
      });

      await batch.commit();

      // atualiza localmente o grupo
      const patchGrupo: any = {
        designadoParaUid: assessorUid,
        designadoParaNome: assessorNome,
        encaminhadoParaUid: assessorUid,
        encaminhadoParaNome: assessorNome,
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome ?? null,
        caixaAtual: 'assessor',
        caixaUid: assessorUid,
      };

      this.grupos = this.grupos.map((gg) =>
        (gg as any).id === gid
          ? ({ ...(gg as any), ...patchGrupo } as GrupoSolidario)
          : gg
      );
      this.aplicarFiltrosGrupos();

      // e atualiza localmente as pessoas (membros + coordenador)
      const idsArr = Array.from(ids);
      const patchPessoa: any = { ...patchGrupo };
      this.pessoas = this.pessoas.map((p) =>
        p.id && idsArr.includes(p.id)
          ? ({ ...(p as any), ...patchPessoa } as PreCadastro)
          : p
      );
      this.aplicarFiltrosPessoas();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao encaminhar grupo:', e);
      alert('Não foi possível encaminhar o grupo. Tente novamente.');
    }
  }

  // ====================================================
  // DETALHE DO GRUPO (coordenador + membros)
  // ====================================================
  abrirDetalheGrupo(g: GrupoSolidario) {
    this.grupoDetalhe = g;
    this.showGrupoDetalhe = true;
  }

  fecharDetalheGrupo() {
    this.showGrupoDetalhe = false;
    this.grupoDetalhe = null;
  }

  qtdMembrosGrupo(g: GrupoSolidario): number {
    const membros = (g as any).membrosView || [];
    const coord = (g as any).coordenadorView || null;

    if (!coord) return membros.length;

    // Remove o coordenador se estiver dentro dos membros
    const membrosUnicos = membros.filter(
      (m: any) => m.preCadastroId !== coord.preCadastroId
    );

    return membrosUnicos.length + 1; // soma apenas se for realmente diferente
  }

}
