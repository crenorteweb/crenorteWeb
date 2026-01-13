import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Agendamento } from '../models/agendamento.model';

@Injectable({ providedIn: 'root' })
export class AgendamentoService {
  private db = inject(Firestore);
  private col = collection(this.db, 'agendamentos');

  /** Cria um agendamento e retorna o ID gerado */
  async criar(data: Omit<Agendamento, 'id' | 'createdAt'>): Promise<string> {
    const payload: any = {
      ...data,
      createdAt: serverTimestamp(), // ✅ sem Timestamp.now()
    };
    const ref = await addDoc(this.col, payload);
    return ref.id;
  }

  /** Lista agendamentos do assessor logado (ordenado por data/hora) */
  async listarDoAssessor(assessorUid: string): Promise<Agendamento[]> {
    const q = query(
      this.col,
      where('assessorUid', '==', assessorUid),
      orderBy('dataHora', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Agendamento[];
  }

  /** Atualiza campos de um agendamento */
  async atualizar(id: string, patch: Partial<Agendamento>): Promise<void> {
    const ref = doc(this.db, 'agendamentos', id);
    await updateDoc(ref, patch as any);
  }

  /** Remove um agendamento */
  async remover(id: string): Promise<void> {
    const ref = doc(this.db, 'agendamentos', id);
    await deleteDoc(ref);
  }
}
