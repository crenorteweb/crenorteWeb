import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  documentId,
  CollectionReference,
  DocumentData,
} from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { PreCadastro, CargoFiltro } from '../models/producao.model';

@Injectable({ providedIn: 'root' })
export class ProducaoService {
  private db = inject(Firestore);

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
    const assessorUid: string = raw.createdByUid || '';
    const assessorNome: string = nomes?.get(assessorUid)
      || (raw.createdByNome && raw.createdByNome !== 'Assessor' ? raw.createdByNome : '')
      || nomes?.get(assessorUid)
      || raw.createdByNome
      || '';

    return {
      id: raw.id,
      clienteNome: raw.nomeCompleto || raw.clienteNome,
      cpf: raw.cpf,
      telefone: raw.telefone,
      municipio: raw.cidade || raw.municipio || raw.bairro,
      bairro: raw.bairro || '',
      origem: raw.origem || '',
      status: raw.aprovacao?.status,
      assessorId: assessorUid,
      assessorNome,
      analistaId: raw.aprovacao?.porUid || raw.analistaId,
      analistaNome: (() => {
        const uid  = raw.aprovacao?.porUid || raw.analistaId || '';
        const nome = raw.aprovacao?.porNome || raw.analistaNome || '';
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
      encaminhadoEm: raw.encaminhamento?.em || raw.createdAt,
      analisadoEm: raw.aprovacao?.em,
      elegivel: raw.elegivel ? { status: raw.elegivel.status } : undefined,
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

  // ── Implementações privadas ───────────────────────────────────────────────

  private async _assessor(uid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const snap = await getDocs(
      query(this.preCadRef, where('createdByUid', '==', uid))
    );
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isInRange(r.createdAt, dataInicio, dataFim));

    const result = filtered.map(r => this.mapRaw(r));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    return result;
  }

  private async _analista(uid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const snap = await getDocs(
      query(this.preCadRef, where('aprovacao.porUid', '==', uid))
    );
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isInRange(r.aprovacao?.em, dataInicio, dataFim));

    // Enriquece nomes dos assessores via colaboradores
    const uids = filtered.map(r => r.createdByUid).filter(Boolean);
    const nomes = await this.fetchNomesByUids(uids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.analisadoEm) - this.getTime(a.analisadoEm));
    return result;
  }

  private async _supervisor(supervisorUid: string, dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    // Passo 1 — assessores sob este supervisor
    const assessoresSnap = await getDocs(
      query(
        this.colabRef,
        where('supervisorId', '==', supervisorUid),
        where('papel', '==', 'assessor')
      )
    );

    const nomes = new Map<string, string>();
    assessoresSnap.docs.forEach(d => {
      const nome: string = (d.data() as any).nome || '';
      if (nome) nomes.set(d.id, nome);
    });

    const assessorUids = assessoresSnap.docs.map(d => d.id);
    if (!assessorUids.length) return [];

    // Passo 2 — pre_cadastros dos assessores (chunks de 10)
    const all: any[] = [];
    for (let i = 0; i < assessorUids.length; i += 10) {
      const chunk = assessorUids.slice(i, i + 10);
      const qy = chunk.length === 1
        ? query(this.preCadRef, where('createdByUid', '==', chunk[0]))
        : query(this.preCadRef, where('createdByUid', 'in', chunk));
      const snap = await getDocs(qy);
      snap.docs.forEach(d => all.push({ id: d.id, ...(d.data() as any) }));
    }

    const filtered = all.filter(r => this.isInRange(r.createdAt, dataInicio, dataFim));
    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    return result;
  }

  private async _todosAnalisados(dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const [snapAnalisados, snapNaCaixa] = await Promise.all([
      getDocs(query(this.preCadRef, where('aprovacao.status', 'in', ['apto', 'inapto']))),
      getDocs(query(this.preCadRef, where('caixaAtual', '==', 'analista'))),
    ]);

    const analisados = snapAnalisados.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isInRange(r.aprovacao?.em, dataInicio, dataFim));

    const idsAnalisados = new Set(analisados.map(r => r.id));

    const naoAnalisados = snapNaCaixa.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r =>
        !idsAnalisados.has(r.id) &&
        this.isInRange(r.encaminhamento?.em ?? r.createdAt, dataInicio, dataFim)
      );

    const filtered = [...analisados, ...naoAnalisados];

    const assessorUids = [...new Set(filtered.map(r => r.createdByUid).filter(Boolean) as string[])];
    const analistaUids = [...new Set(filtered.map(r => r.aprovacao?.porUid).filter(Boolean) as string[])];

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
    return result;
  }

  private async _adicionados(dataInicio: string, dataFim: string): Promise<PreCadastro[]> {
    const snap = await getDocs(this.preCadRef);
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isInRange(r.createdAt, dataInicio, dataFim));

    const assessorUids = [...new Set(filtered.map(r => r.createdByUid).filter(Boolean) as string[])];
    const nomes = await this.fetchNomesByUids(assessorUids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.criadoEm) - this.getTime(a.criadoEm));
    return result;
  }
}
