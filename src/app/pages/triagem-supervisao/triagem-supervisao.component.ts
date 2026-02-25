import { Component, OnInit, OnDestroy, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
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
  updateDoc,
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
};

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
  private injector = inject(EnvironmentInjector);

  // ====== estado usuário atual ======
  currentUserUid: string | null = null;
  currentUserNome: string | null = null;
  private readonly user$ = user(this.auth); // field initializer — garante injection context
  private subUser?: Subscription;

  // cache de nomes para não ficar lendo o mesmo colaborador sempre
  private nomeCache = new Map<string, string>();

  // ====== abas / UI básica ======
  loading = false;
  aba: Aba = 'pessoas';

  searchTerm = '';
  filtroAssessor: string | 'todos' = 'todos';

  /** Conjunto de filtros booleanos ativos (toggle múltiplo). */
  filtrosAtivos: Record<string, boolean> = {};

  // ====== pessoas ======
  pessoas: PreCadastro[] = [];      // base completa (caixa + encaminhados + membros de grupos)
  pessoasView: PreCadastro[] = [];  // filtradas pela busca/filtros

  // ====== grupos ======
  grupos: GrupoSolidario[] = [];       // grupos da lista
  gruposView: GrupoSolidario[] = [];   // filtrados pela busca

  // ====== assessores (time do analista) ======
  assessores: Assessor[] = [];
  assessoresFiltrados: Assessor[] = [];

  // ====== analistas da equipe (apenas para supervisores) ======
  analistasDaMinhaEquipe: string[] = [];

  // ====== analistaId sincronizado do perfil do Supervisor ======
  analistaIdSincronizado: string | null = null;

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
    this.subUser = this.user$.subscribe((u) => {
      runInInjectionContext(this.injector, async () => {
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

          await this.carregarAnalistasDaMinhaEquipe(u.uid);
          await this.sincronizarAnalistaId(u.uid);
          await this.carregarAssessoresDoMeuTime(u.uid);
          await this.carregarPessoasDoAnalista(u.uid);
          await this.carregarGruposDoAnalista(u.uid);
          await this.mesclarPreCadastrosDeGrupos();

          this.aplicarFiltrosPessoas();
          this.aplicarFiltrosGrupos();
        } catch (e) {
          console.error('[TriagemSupervisao] erro ao iniciar:', e);
          this.resetarListas();
        } finally {
          this.loading = false;
        }
      });
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
  }

  setAssessorFilter(uid: string | 'todos') {
    this.filtroAssessor = uid;
    this.aplicarFiltrosPessoas();
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
  // CARREGAR ASSESSORES DO MEU TIME
  // ====================================================
  private async carregarAssessoresDoMeuTime(meUid: string): Promise<void> {
    try {
      const ref = collection(this.afs, 'colaboradores');
      const uidsSet = new Set<string>([meUid, ...this.analistasDaMinhaEquipe]);
      if (this.analistaIdSincronizado) uidsSet.add(this.analistaIdSincronizado);
      const uids = Array.from(uidsSet);

      // Para cada UID da equipe: supervisorId, supervisorUid e analistaId (campos variados no Firestore)
      const snaps = await runInInjectionContext(this.injector, () => {
        const ps = uids.flatMap(uid => [
          getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'), where('supervisorId', '==', uid))),
          getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'), where('supervisorUid', '==', uid))),
          getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'), where('analistaId', '==', uid))),
        ]);
        return Promise.all(ps);
      });

      const map = new Map<string, Assessor>();
      const pushDoc = (d: any) => {
        const data = d.data() as any;
        map.set(d.id, {
          uid: d.id,
          nome: data?.nome || data?.displayName || data?.email || 'Assessor',
          email: data?.email || null,
          rota: data?.rota || null,
        });
      };

      snaps.forEach(snap => snap.docs.forEach(pushDoc));

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
  // DESCOBRIR ANALISTAS DA EQUIPE DO SUPERVISOR
  // ====================================================
  private async carregarAnalistasDaMinhaEquipe(meUid: string): Promise<void> {
    try {
      const ref = collection(this.afs, 'colaboradores');
      // Dois campos possíveis no Firestore: supervisorId e supervisorUid
      const [snapById, snapByUid] = await runInInjectionContext(this.injector, () => Promise.all([
        getDocs(fsQuery(ref, where('papel', '==', 'analista'), where('status', '==', 'ativo'), where('supervisorId', '==', meUid))),
        getDocs(fsQuery(ref, where('papel', '==', 'analista'), where('status', '==', 'ativo'), where('supervisorUid', '==', meUid))),
      ]));
      const ids = new Set<string>();
      snapById.docs.forEach(d => ids.add(d.id));
      snapByUid.docs.forEach(d => ids.add(d.id));
      this.analistasDaMinhaEquipe = Array.from(ids);
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar analistas da equipe:', e);
      this.analistasDaMinhaEquipe = [];
    }
  }

  // ====================================================
  // SINCRONIZAR analistaId NO PERFIL DO SUPERVISOR
  // ====================================================
  private async sincronizarAnalistaId(meUid: string): Promise<void> {
    try {
      // 1. Verificar se o perfil já tem analistaId
      const supervisorSnap = await runInInjectionContext(this.injector, () => getDoc(doc(this.afs, 'colaboradores', meUid)));
      if (!supervisorSnap.exists()) return;

      const supervisorData: any = supervisorSnap.data();
      if (supervisorData?.analistaId) {
        this.analistaIdSincronizado = supervisorData.analistaId;
        return; // já preenchido — nada a fazer
      }

      // 2. Busca assessores vinculados ao Supervisor (por supervisorId OU supervisorUid)
      const ref = collection(this.afs, 'colaboradores');
      const [assessorSnapById, assessorSnapByUid] = await runInInjectionContext(this.injector, () => Promise.all([
        getDocs(fsQuery(ref, where('papel', '==', 'assessor'), where('supervisorId', '==', meUid), limit(1))),
        getDocs(fsQuery(ref, where('papel', '==', 'assessor'), where('supervisorUid', '==', meUid), limit(1))),
      ]));
      const assessorDoc = (!assessorSnapById.empty ? assessorSnapById : assessorSnapByUid).docs[0];
      if (!assessorDoc) return;

      const analistaId: string | null = (assessorDoc.data() as any)?.analistaId || null;
      if (!analistaId) return;

      // 3. Gravar no perfil do Supervisor (somente uma vez, campo estava vazio)
      await runInInjectionContext(this.injector, () => updateDoc(doc(this.afs, 'colaboradores', meUid), { analistaId }));

      this.analistaIdSincronizado = analistaId;
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao sincronizar analistaId:', e);
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

  private async carregarPessoasDoAnalista(meUid: string): Promise<void> {
    try {
      const mapRows = new Map<string, PreCadastro>();
      const preRef = collection(this.afs, 'pre_cadastros');
      const svcAny = this.preSvc as any;

      // 1. Itens criados pelo Supervisor  2. Itens na caixa do Supervisor
      const [snapCreated, snapCaixa] = await runInInjectionContext(this.injector, () => Promise.all([
        getDocs(fsQuery(preRef, where('createdByUid', '==', meUid))),
        getDocs(fsQuery(preRef, where('caixaUid', '==', meUid))),
      ]));
      const mergeDoc = (d: any) => {
        if (d.id && !mapRows.has(d.id))
          mapRows.set(d.id, { id: d.id, ...d.data() } as PreCadastro);
      };
      snapCreated.docs.forEach(mergeDoc);
      snapCaixa.docs.forEach(mergeDoc);

      // Analistas da equipe — busca via listarParaCaixa + encaminhadosPor
      const uidsEquipe = new Set<string>([...this.analistasDaMinhaEquipe]);
      if (this.analistaIdSincronizado) uidsEquipe.add(this.analistaIdSincronizado);

      for (const uid of uidsEquipe) {
        const [base, encaminhados] = await Promise.all([
          typeof svcAny.listarParaCaixa === 'function'
            ? svcAny.listarParaCaixa(uid)
            : this.preSvc.listarDoAssessor(uid),
          this.buscarPreCadastrosEncaminhadosPor(uid),
        ]);

        for (const r of base || []) {
          if (r?.id) mapRows.set(r.id, r);
        }
        for (const e of encaminhados || []) {
          if (!e?.id) continue;
          const atual = mapRows.get(e.id);
          mapRows.set(e.id, { ...(atual as any), ...(e as any) } as PreCadastro);
        }
      }

      // 3. analistaId == analistaIdSincronizado (campo direto no pre_cadastro)
      if (this.analistaIdSincronizado) {
        try {
          const snapAnalistaId = await runInInjectionContext(this.injector, () => getDocs(fsQuery(
            preRef,
            where('analistaId', '==', this.analistaIdSincronizado)
          )));
          snapAnalistaId.forEach(d => {
            if (!mapRows.has(d.id))
              mapRows.set(d.id, { id: d.id, ...d.data() } as PreCadastro);
          });
        } catch (e) {
          console.error('[TriagemSupervisao] erro ao buscar por analistaId:', e);
        }
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

  // =========== busca extra: pré-cadastros que ESTE analista encaminhou ===========
  private async buscarPreCadastrosEncaminhadosPor(
    uid: string
  ): Promise<PreCadastro[]> {
    try {
      const ref = collection(this.afs, 'pre_cadastros');
      const q = fsQuery(ref, where('encaminhadoPorUid', '==', uid));
      const snap = await runInInjectionContext(this.injector, () => getDocs(q));

      const lista: PreCadastro[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        lista.push({ id: docSnap.id, ...data } as PreCadastro);
      });

      return lista;
    } catch (e) {
      console.error(
        '[TriagemSupervisao] erro ao buscar pre_cadastros encaminhados:',
        e
      );
      return [];
    }
  }

  // ====================================================
  // CARREGAR GRUPOS DO ANALISTA
  // (igual Lista: caixa + grupos encaminhados por mim + joinGruposView)
  // ====================================================
  private async buscarGruposEncaminhadosPor(
    uid: string
  ): Promise<GrupoSolidario[]> {
    try {
      const ref = collection(this.afs, 'grupos_solidarios');
      const q = fsQuery(ref, where('encaminhadoPorUid', '==', uid));
      const snap = await runInInjectionContext(this.injector, () => getDocs(q));

      const lista: GrupoSolidario[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        lista.push({ id: docSnap.id, ...data } as GrupoSolidario);
      });

      return lista;
    } catch (e) {
      console.error(
        '[TriagemSupervisao] erro ao buscar grupos encaminhados:',
        e
      );
      return [];
    }
  }

  private async carregarGruposDoAnalista(meUid: string): Promise<void> {
    try {
      const uidsSet = new Set<string>([meUid, ...this.analistasDaMinhaEquipe]);
      if (this.analistaIdSincronizado) uidsSet.add(this.analistaIdSincronizado);
      const uids = Array.from(uidsSet);
      const map = new Map<string, GrupoSolidario>();

      for (const uid of uids) {
        const [base, encaminhadosPorMim] = await Promise.all([
          this.gruposSvc.listarParaCaixaAssessor(uid),
          this.buscarGruposEncaminhadosPor(uid),
        ]);

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

      // busca em paralelo os pré-cadastros que não estavam em this.pessoas
      await Promise.all(
        Array.from(faltando.entries()).map(async ([preId, info]) => {
          try {
            const snap = await getDoc(doc(this.afs, 'pre_cadastros', preId));
            if (!snap.exists()) return;

            const data = snap.data() as any;
            atuais.set(preId, {
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
            } as PreCadastro);
          } catch (e) {
            console.error('[Grupos->Pessoas] erro ao buscar pre_cadastro', preId, e);
          }
        })
      );

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

  setEnvioFilter(f: string) {
    if (f === 'todos') {
      this.filtrosAtivos = {};
    } else {
      this.filtrosAtivos = { ...this.filtrosAtivos, [f]: !this.filtrosAtivos[f] };
    }
    this.aplicarFiltrosPessoas();
  }

  nenhumFiltroAtivo(): boolean {
    return !Object.values(this.filtrosAtivos).some(Boolean);
  }

  private aplicarFiltrosPessoas() {
    let list = [...this.pessoas];

    // Filtros de aprovação — OR dentro do grupo (apto/inapto)
    const filtrosAprovacao = (['apto', 'inapto'] as const).filter(f => !!this.filtrosAtivos[f]);
    if (filtrosAprovacao.length > 0) {
      list = list.filter((p) => {
        const status = (p as any).aprovacao?.status || 'nao_verificado';
        return filtrosAprovacao.includes(status as any);
      });
    }

    // Filtros de encaminhamento — se ambos ativos, cancelam-se (exibir tudo)
    const temEnc    = !!this.filtrosAtivos['encaminhado'];
    const temNaoEnc = !!this.filtrosAtivos['nao_encaminhado'];
    if (temEnc && !temNaoEnc) {
      list = list.filter((p) => !!(p as any).encaminhadoParaUid);
    } else if (temNaoEnc && !temEnc) {
      list = list.filter((p) => !(p as any).encaminhadoParaUid);
    }


    // filtro por assessor (somente quando encaminhado)
    if (this.filtroAssessor !== 'todos') {
      list = list.filter((p) =>
        (p as any).encaminhadoParaUid === this.filtroAssessor
      );
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

  encaminhadoLabel(p: PreCadastro): string | null {
    const encNome =
      (p as any).encaminhadoParaNome ||
      (p as any).encaminhamento?.assessorNome ||
      null;
    if (!encNome) return null;
    return `Encaminhado para ${encNome}`;
  }

  getStatusClass(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'apto':
      return 'bg-success';
    case 'inapto':
      return 'bg-danger';
    case 'nao_verificado':
      return 'bg-secondary';
    default:
      return 'bg-secondary';
  }
}

  // ====================================================
  // FORMATAÇÃO DE DATA/HORA (Timestamps Firebase)
  // ====================================================
  formatarDataHora(data: any): string {
    if (!data) return '—';
    let d: Date | null = null;
    if (typeof data?.toDate === 'function') {
      try { d = data.toDate(); } catch { return '—'; }
    } else if (data instanceof Date) {
      d = data;
    } else if (typeof data === 'number') {
      d = new Date(data);
    }
    if (!d || isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
