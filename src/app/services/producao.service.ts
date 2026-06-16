import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  documentId,
  Timestamp,
  CollectionReference,
  DocumentData,
} from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { PreCadastro, CargoFiltro } from '../models/producao.model';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class ProducaoService {
  private db    = inject(Firestore);
  private cache = inject(CacheService);

  private readonly preCadRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  private readonly colabRef: CollectionReference<DocumentData> =
    collection(this.db, 'colaboradores') as CollectionReference<DocumentData>;

  // ── Utilitários ───────────────────────────────────────────────────────────

  private getTime(ts: any): number {
    if (!ts) return 0;
    try {
      return ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
    } catch { return 0; }
  }

  private cleanStr(val: any): string {
    const s = (val ?? '').toString().trim();
    return s === 'undefined' || s === 'null' ? '' : s;
  }

  /** Verifica se um Timestamp está dentro do intervalo [dataInicio, dataFim] (YYYY-MM-DD, fuso local) */
  private isInRange(ts: any, dataInicio: string, dataFim: string): boolean {
    if (!ts) return false;
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d.getTime())) return false;
      const [yi, mi, di] = dataInicio.split('-').map(Number);
      const [yf, mf, df] = dataFim.split('-').map(Number);
      const inicio = new Date(yi, mi - 1, di, 0, 0, 0, 0);
      const fim    = new Date(yf, mf - 1, df, 23, 59, 59, 999);
      return d >= inicio && d <= fim;
    } catch { return false; }
  }

  private cacheKey(...parts: string[]): string {
    return `producao_${parts.join('_')}`;
  }

  private toTimestampRange(dataInicio: string, dataFim: string): { inicio: Timestamp; fim: Timestamp } {
    const [yi, mi, di] = dataInicio.split('-').map(Number);
    const [yf, mf, df] = dataFim.split('-').map(Number);
    return {
      inicio: Timestamp.fromDate(new Date(yi, mi - 1, di, 0, 0, 0, 0)),
      fim:    Timestamp.fromDate(new Date(yf, mf - 1, df, 23, 59, 59, 999)),
    };
  }

  /** Busca nomes de colaboradores em lote por IDs de documento (assessores) */
  private async fetchNomesByUids(uids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(uids)].filter(Boolean);
    if (!unique.length) return map;

    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const qy = chunk.length === 1
        ? query(this.colabRef, where(documentId(), '==', chunk[0]))
        : query(this.colabRef, where(documentId(), 'in', chunk));
      const snap = await getDocs(qy);
      snap.docs.forEach(d => {
        const nome: string = (d.data() as any).nome || '';
        if (nome) map.set(d.id, nome);
      });
    }
    return map;
  }

  /**
   * Busca nomes de colaboradores pelo campo `uid` (Firebase Auth UID).
   * Necessário para analistas cujo document ID difere do Auth UID.
   */
  private async fetchNomesByAuthUid(authUids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(authUids)].filter(Boolean);
    if (!unique.length) return map;

    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const qy = chunk.length === 1
        ? query(this.colabRef, where('uid', '==', chunk[0]))
        : query(this.colabRef, where('uid', 'in', chunk));
      const snap = await getDocs(qy);
      snap.docs.forEach(d => {
        const data = d.data() as any;
        const nome: string = data.nome || '';
        const uid: string  = data.uid  || '';
        if (nome && uid) map.set(uid, nome);
      });
    }
    return map;
  }

  /** Mapeia dado bruto do Firestore para PreCadastro do módulo */
  private mapRaw(raw: any, nomes?: Map<string, string>): PreCadastro {
    const assessorUid: string = this.cleanStr(raw.createdByUid);
    const assessorNome: string = nomes?.get(assessorUid)
      || (raw.createdByNome && raw.createdByNome !== 'Assessor' ? this.cleanStr(raw.createdByNome) : '')
      || nomes?.get(assessorUid)
      || this.cleanStr(raw.createdByNome)
      || '';

    return {
      id: raw.id,
      clienteNome: raw.nomeCompleto || raw.clienteNome,
      cpf: raw.cpf,
      telefone: raw.telefone,
      municipio: raw.cidade || raw.municipio,
      uf: raw.uf || raw.estado || '',
      bairro: raw.bairro || '',
      origem: raw.origem || '',
      status: raw.aprovacao?.status,
      assessorId: assessorUid,
      assessorNome,
      analistaId: this.cleanStr(raw.aprovacao?.porUid || raw.analistaId),
      analistaNome: (() => {
        const uid  = this.cleanStr(raw.aprovacao?.porUid || raw.analistaId || '');
        const nome = this.cleanStr(raw.aprovacao?.porNome || raw.analistaNome || '');
        // Se porNome foi salvo erroneamente como o próprio UID, ignora e usa o mapa
        return (nome && nome !== uid ? nome : '') || nomes?.get(uid) || '';
      })(),
      resultado: raw.aprovacao?.status === 'apto' ? 'apto'
               : raw.aprovacao?.status === 'inapto' ? 'inapto'
               : undefined,
      motivoInapto: raw.aprovacao?.motivo || raw.motivoInapto,
      contatoRealizado: raw.contatoRealizado,
      observacaoAssessor: raw.observacao || raw.observacaoAssessor,
      agendamento: raw.agendamento,
      formalizado: raw.formalizado,
      criadoEm: raw.createdAt,
      encaminhadoEm: raw.encaminhadoEm || raw.encaminhamento?.em || raw.createdAt,
      analisadoEm: raw.aprovacao?.em,
      elegivel: raw.elegivel ? { status: raw.elegivel.status } : undefined,
      encaminhadoPorUid: this.cleanStr(raw.encaminhadoPorUid),
      encaminhadoPorNome: (() => {
        const stored = this.cleanStr(raw.encaminhadoPorNome);
        const nome = stored.includes('@') ? '' : stored;
        return nome
          || nomes?.get(this.cleanStr(raw.encaminhadoPorUid))
          || (!this.cleanStr(raw.encaminhadoPorUid) && this.cleanStr(raw.encaminhamento?.assessorUid) ? 'Call Center' : '');
      })(),
      encaminhadoParaUid: this.cleanStr(raw.encaminhadoParaUid || raw.designadoParaUid || raw.encaminhamento?.assessorUid || raw.analistaUid),
      encaminhadoParaNome: this.cleanStr(raw.encaminhadoParaNome || raw.designadoParaNome || raw.encaminhamento?.assessorNome || raw.analistaNome)
        || nomes?.get(this.cleanStr(raw.encaminhadoParaUid || raw.designadoParaUid || raw.encaminhamento?.assessorUid || raw.analistaUid)) || '',
    };
  }

  // ── API pública (Observable) ──────────────────────────────────────────────

  buscarPorAssessor(assessorId: string, dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._assessor(assessorId, dataInicio, dataFim));
  }

  buscarPorAnalista(analistaId: string, dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._analista(analistaId, dataInicio, dataFim));
  }

  buscarPorSupervisor(supervisorId: string, dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._supervisor(supervisorId, dataInicio, dataFim));
  }

  buscarTodosAnalisados(dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._todosAnalisados(dataInicio, dataFim));
  }

  buscarAdicionados(dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._adicionados(dataInicio, dataFim));
  }

  buscarEncaminhados(dataInicio: string, dataFim: string): Observable<PreCadastro[]> {
    return from(this._encaminhados(dataInicio, dataFim));
  }

  buscarCaixaAssessores(): Observable<PreCadastro[]> {
    return from(this._caixaAssessores());
  }

  // ── Implementações privadas ───────────────────────────────────────────────

  private async _assessor(uid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('assessor', uid, dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);
    let raws: any[];
    try {
      const snap = await getDocs(query(
        this.preCadRef,
        where('createdByUid', '==', uid),
        where('createdAt', '>=', inicio),
        where('createdAt', '<=', fim),
      ));
      raws = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch {
      const snap = await getDocs(query(this.preCadRef, where('createdByUid', '==', uid)));
      raws = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => this.isInRange(r.createdAt, dataInicio, dataFim));
    }

    const result = raws.map(r => this.mapRaw(r));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _analista(uid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('analista', uid, dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);
    let filtered: any[];
    try {
      const snap = await getDocs(query(
        this.preCadRef,
        where('aprovacao.porUid', '==', uid),
        where('aprovacao.em', '>=', inicio),
        where('aprovacao.em', '<=', fim),
      ));
      filtered = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch {
      const snap = await getDocs(query(this.preCadRef, where('aprovacao.porUid', '==', uid)));
      filtered = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => this.isInRange(r.aprovacao?.em, dataInicio, dataFim));
    }

    const uids = filtered.map(r => r.createdByUid).filter(Boolean);
    const nomes = await this.fetchNomesByUids(uids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.analisadoEm) - this.getTime(a.analisadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _supervisor(supervisorUid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('supervisor', supervisorUid, dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    const assessoresSnap = await getDocs(query(
      this.colabRef,
      where('supervisorId', '==', supervisorUid),
      where('papel', '==', 'assessor'),
    ));

    const nomes = new Map<string, string>();
    assessoresSnap.docs.forEach(d => {
      const nome: string = (d.data() as any).nome || '';
      if (nome) nomes.set(d.id, nome);
    });

    const assessorUids = assessoresSnap.docs.map(d => d.id);
    if (!assessorUids.length) return [];

    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);
    const all: any[] = [];

    for (let i = 0; i < assessorUids.length; i += 10) {
      const chunk = assessorUids.slice(i, i + 10);
      const eq = chunk.length === 1
        ? where('createdByUid', '==', chunk[0])
        : where('createdByUid', 'in', chunk);
      try {
        const snap = await getDocs(query(
          this.preCadRef, eq,
          where('createdAt', '>=', inicio),
          where('createdAt', '<=', fim),
        ));
        snap.docs.forEach(d => all.push({ id: d.id, ...(d.data() as any) }));
      } catch {
        const snap = await getDocs(query(this.preCadRef, eq));
        snap.docs
          .filter(d => this.isInRange((d.data() as any).createdAt, dataInicio, dataFim))
          .forEach(d => all.push({ id: d.id, ...(d.data() as any) }));
      }
    }

    const result = all.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _todosAnalisados(dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('todosAnalisados', dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);

    // Firestore não permite `in` + range em campos diferentes.
    // Solução: duas queries separadas (apto e inapto) com filtro de data no servidor.
    // Fallback caso os índices compostos ainda não existam.
    let analisados: any[];
    try {
      const [snapApto, snapInapto] = await Promise.all([
        getDocs(query(this.preCadRef, where('aprovacao.status', '==', 'apto'),   where('aprovacao.em', '>=', inicio), where('aprovacao.em', '<=', fim))),
        getDocs(query(this.preCadRef, where('aprovacao.status', '==', 'inapto'), where('aprovacao.em', '>=', inicio), where('aprovacao.em', '<=', fim))),
      ]);
      analisados = [
        ...snapApto.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
        ...snapInapto.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
      ];
    } catch {
      const snap = await getDocs(query(this.preCadRef, where('aprovacao.status', 'in', ['apto', 'inapto'])));
      analisados = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => this.isInRange(r.aprovacao?.em, dataInicio, dataFim));
    }

    const idsAnalisados = new Set(analisados.map(r => r.id));

    const snapNaCaixa = await getDocs(query(this.preCadRef, where('caixaAtual', '==', 'analista')));
    const naoAnalisados = snapNaCaixa.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r =>
        !idsAnalisados.has(r.id) &&
        this.isInRange(r.encaminhamento?.em ?? r.createdAt, dataInicio, dataFim)
      );

    const filtered = [...analisados, ...naoAnalisados];

    const assessorUids = [...new Set(filtered.map(r => this.cleanStr(r.createdByUid)).filter(Boolean) as string[])];
    const analistaUids = [...new Set(filtered.map(r => this.cleanStr(r.aprovacao?.porUid)).filter(Boolean) as string[])];

    const [nomesAssessores, nomesAnalistas] = await Promise.all([
      this.fetchNomesByUids(assessorUids),
      this.fetchNomesByAuthUid(analistaUids),
    ]);
    const nomes = new Map([...nomesAssessores, ...nomesAnalistas]);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) =>
      this.getTime(b.analisadoEm ?? b.encaminhadoEm) -
      this.getTime(a.analisadoEm ?? a.encaminhadoEm)
    );
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _encaminhados(dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('encaminhados', dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    // Usa encaminhadoEm (campo top-level salvo com serverTimestamp) para filtrar no servidor.
    // Fallback: filtra por createdAt caso o índice ainda não exista.
    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);
    let raws: any[];
    try {
      const snap = await getDocs(query(
        this.preCadRef,
        where('encaminhadoEm', '>=', inicio),
        where('encaminhadoEm', '<=', fim),
      ));
      raws = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch {
      const snap = await getDocs(query(
        this.preCadRef,
        where('createdAt', '>=', inicio),
        where('createdAt', '<=', fim),
      ));
      raws = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    }

    // Confirmação in-memory: deve ter sido encaminhado e data dentro do intervalo
    const filtered = raws.filter(r => {
      const para = this.cleanStr(r.encaminhadoParaUid || r.designadoParaUid || r.encaminhamento?.assessorUid);
      const por  = this.cleanStr(r.encaminhadoPorUid);
      const dataRef = r.encaminhadoEm ?? r.encaminhamento?.em ?? null;
      return (para || por) && this.isInRange(dataRef, dataInicio, dataFim);
    });

    const porUids  = [...new Set(filtered.map(r => this.cleanStr(r.encaminhadoPorUid)).filter(Boolean) as string[])];
    const paraUids = [...new Set(filtered.map(r => this.cleanStr(
      r.encaminhadoParaUid || r.designadoParaUid || r.encaminhamento?.assessorUid || r.analistaUid
    )).filter(Boolean) as string[])];
    const todosUids = [...new Set([...porUids, ...paraUids])];

    const [nomesPorDoc, nomesPorAuth] = await Promise.all([
      this.fetchNomesByUids(todosUids),
      this.fetchNomesByAuthUid(todosUids),
    ]);
    const nomes = new Map([...nomesPorDoc, ...nomesPorAuth]);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _caixaAssessores(): Promise<PreCadastro[]> {
    const key = this.cacheKey('caixaAssessores');
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    const snap = await getDocs(query(this.preCadRef, where('caixaAtual', '==', 'assessor')));
    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    if (!all.length) return [];

    const uids = [...new Set([
      ...all.map(r => this.cleanStr(r.createdByUid)).filter(Boolean),
      ...all.map(r => this.cleanStr(r.encaminhadoParaUid || r.designadoParaUid || r.encaminhamento?.assessorUid)).filter(Boolean),
    ] as string[])];
    const nomes = await this.fetchNomesByUids(uids);

    const result = all.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }

  private async _adicionados(dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const key = this.cacheKey('adicionados', dataInicio, dataFim);
    const cached = this.cache.get<PreCadastro[]>(key);
    if (cached) return cached;

    // Filtro de data direto no Firestore — elimina o scan completo de 60k docs
    const { inicio, fim } = this.toTimestampRange(dataInicio, dataFim);
    const snap = await getDocs(query(
      this.preCadRef,
      where('createdAt', '>=', inicio),
      where('createdAt', '<=', fim),
    ));

    const filtered = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const assessorUids = [...new Set(filtered.map(r => this.cleanStr(r.createdByUid)).filter(Boolean) as string[])];
    const nomes = await this.fetchNomesByUids(assessorUids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.criadoEm) - this.getTime(a.criadoEm));
    this.cache.set(key, result, 3 * 60 * 1000);
    return result;
  }
}
