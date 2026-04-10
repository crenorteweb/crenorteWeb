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

  /** Verifica se um Timestamp cai no dia indicado (YYYY-MM-DD, fuso local) */
  private isOnDate(ts: any, dateStr: string): boolean {
    if (!ts) return false;
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d.getTime())) return false;
      const [y, m, day] = dateStr.split('-').map(Number);
      return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day;
    } catch { return false; }
  }

  /** Busca nomes de colaboradores em lote por UIDs (IDs dos documentos) */
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
      municipio: raw.cidade || raw.bairro || raw.municipio,
      status: raw.aprovacao?.status,
      assessorId: assessorUid,
      assessorNome,
      analistaId: raw.aprovacao?.porUid || raw.analistaId,
      analistaNome: raw.aprovacao?.porNome || raw.analistaNome,
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
    };
  }

  // ── API pública (Observable) ──────────────────────────────────────────────

  buscarPorAssessor(assessorId: string, data: string): Observable<PreCadastro[]> {
    return from(this._assessor(assessorId, data));
  }

  buscarPorAnalista(analistaId: string, data: string): Observable<PreCadastro[]> {
    return from(this._analista(analistaId, data));
  }

  buscarPorSupervisor(supervisorId: string, data: string): Observable<PreCadastro[]> {
    return from(this._supervisor(supervisorId, data));
  }

  buscarTodosAnalisados(data: string): Observable<PreCadastro[]> {
    return from(this._todosAnalisados(data));
  }

  // ── Implementações privadas ───────────────────────────────────────────────

  private async _assessor(uid: string, data: string): Promise<PreCadastro[]> {
    const snap = await getDocs(
      query(this.preCadRef, where('createdByUid', '==', uid))
    );
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isOnDate(r.createdAt, data));

    const result = filtered.map(r => this.mapRaw(r));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    return result;
  }

  private async _analista(uid: string, data: string): Promise<PreCadastro[]> {
    const snap = await getDocs(
      query(this.preCadRef, where('aprovacao.porUid', '==', uid))
    );
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isOnDate(r.aprovacao?.em, data));

    // Enriquece nomes dos assessores via colaboradores
    const uids = filtered.map(r => r.createdByUid).filter(Boolean);
    const nomes = await this.fetchNomesByUids(uids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.analisadoEm) - this.getTime(a.analisadoEm));
    return result;
  }

  private async _supervisor(supervisorUid: string, data: string): Promise<PreCadastro[]> {
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

    const filtered = all.filter(r => this.isOnDate(r.createdAt, data));
    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.encaminhadoEm) - this.getTime(a.encaminhadoEm));
    return result;
  }

  private async _todosAnalisados(data: string): Promise<PreCadastro[]> {
    const snap = await getDocs(
      query(this.preCadRef, where('aprovacao.status', 'in', ['apto', 'inapto']))
    );
    const filtered = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => this.isOnDate(r.aprovacao?.em, data));

    const assessorUids = [...new Set(
      filtered.map(r => r.createdByUid).filter(Boolean) as string[]
    )];
    const nomes = await this.fetchNomesByUids(assessorUids);

    const result = filtered.map(r => this.mapRaw(r, nomes));
    result.sort((a, b) => this.getTime(b.analisadoEm) - this.getTime(a.analisadoEm));
    return result;
  }
}
