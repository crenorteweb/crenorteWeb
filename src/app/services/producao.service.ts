import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  CollectionReference,
  DocumentData,
} from '@angular/fire/firestore';
import { PreCadastro } from '../models/pre-cadastro.model';
import { Colaborador } from '../models/colaborador.model';

@Injectable({ providedIn: 'root' })
export class ProducaoService {
  private db = inject(Firestore);

  private readonly preCadRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  private readonly colabRef: CollectionReference<DocumentData> =
    collection(this.db, 'colaboradores') as CollectionReference<DocumentData>;

  /** Verifica se um Timestamp/Date cai no mesmo dia calendário que `date` (hora local) */
  private isOnDate(timestamp: any, date: Date): boolean {
    if (!timestamp) return false;
    try {
      const d: Date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
      if (isNaN(d.getTime())) return false;
      return (
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
    } catch {
      return false;
    }
  }

  /** Mapeia um snapshot para Colaborador garantindo que uid e id venham do ID do documento */
  private mapColab(docs: any[]): Colaborador[] {
    return docs.map(d => ({
      ...(d.data() as any),
      id: d.id,
      uid: (d.data() as any).uid || d.id,
    })) as Colaborador[];
  }

  /** Lista colaboradores ativos por papel */
  async buscarColaboradoresPorPapel(papel: string): Promise<Colaborador[]> {
    const qy = query(
      this.colabRef,
      where('papel', '==', papel),
      where('status', '==', 'ativo')
    );
    const snap = await getDocs(qy);
    return this.mapColab(snap.docs);
  }

  /**
   * Produção do Assessor: pré-cadastros criados pelo assessor na data.
   * Filtragem por data é feita no cliente para evitar índice composto no Firestore.
   */
  async buscarProducaoAssessor(uid: string, date: Date): Promise<PreCadastro[]> {
    const qy = query(this.preCadRef, where('createdByUid', '==', uid));
    const snap = await getDocs(qy);
    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
    return all.filter(p => this.isOnDate((p as any).createdAt, date));
  }

  /**
   * Produção do Analista: pré-cadastros analisados (aprovacao.porUid) na data.
   */
  async buscarProducaoAnalista(uid: string, date: Date): Promise<PreCadastro[]> {
    const qy = query(this.preCadRef, where('aprovacao.porUid', '==', uid));
    const snap = await getDocs(qy);
    const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
    return all.filter(p => this.isOnDate(p.aprovacao?.em, date));
  }

  /**
   * Produção do Supervisor: pré-cadastros criados pelos assessores sob este supervisor na data.
   * Passo 1: busca assessores com supervisorId == supervisorUid.
   * Passo 2: busca pré-cadastros criados por esses assessores (chunks de 10 por limitação do Firestore).
   */
  async buscarProducaoSupervisor(supervisorUid: string, date: Date): Promise<PreCadastro[]> {
    const assessoresQy = query(
      this.colabRef,
      where('supervisorId', '==', supervisorUid),
      where('papel', '==', 'assessor')
    );
    const assessoresSnap = await getDocs(assessoresQy);
    const assessorUids = assessoresSnap.docs.map(d => d.id);

    if (!assessorUids.length) return [];

    const all: PreCadastro[] = [];
    for (let i = 0; i < assessorUids.length; i += 10) {
      const chunk = assessorUids.slice(i, i + 10);
      const qy =
        chunk.length === 1
          ? query(this.preCadRef, where('createdByUid', '==', chunk[0]))
          : query(this.preCadRef, where('createdByUid', 'in', chunk));
      const snap = await getDocs(qy);
      snap.docs.forEach(d => all.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
    }

    return all.filter(p => this.isOnDate((p as any).createdAt, date));
  }
}
