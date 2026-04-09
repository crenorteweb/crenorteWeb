import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { Colaborador } from '../models/producao.model';

@Injectable({ providedIn: 'root' })
export class ColaboradoresService {
  private db = inject(Firestore);
  private colabRef = collection(this.db, 'colaboradores');

  /** Retorna colaboradores ativos filtrando pelo papel (cargo) */
  buscarPorCargo(cargo: string): Observable<Colaborador[]> {
    return from(this._buscar(cargo));
  }

  private async _buscar(papel: string): Promise<Colaborador[]> {
    const qy = query(
      this.colabRef,
      where('papel', '==', papel),
      where('status', '==', 'ativo')
    );
    const snap = await getDocs(qy);
    return snap.docs
      .map(d => ({
        id: d.id,
        uid: d.id,
        nome: (d.data() as any).nome || '',
        cargo: ((d.data() as any).papel || papel) as Colaborador['cargo'],
        email: (d.data() as any).email,
      }))
      .filter(c => c.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }
}
