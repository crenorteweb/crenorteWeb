import { Injectable } from '@angular/core';
import { db } from '../firebase.config';
import {
  collection, addDoc, updateDoc, deleteDoc, doc
} from 'firebase/firestore';
import { Unidade } from '../models/unidade.model';

const COLLECTION = 'unidades';

@Injectable({ providedIn: 'root' })
export class UnidadesService {

  async criar(data: Omit<Unidade, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<void> {
    await addDoc(collection(db, COLLECTION), {
      ...data,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
    });
  }

  async atualizar(id: string, data: Partial<Omit<Unidade, 'id' | 'criadoEm'>>): Promise<void> {
    await updateDoc(doc(db, COLLECTION, id), {
      ...data,
      atualizadoEm: Date.now(),
    });
  }

  async excluir(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTION, id));
  }
}
