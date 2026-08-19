import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { from, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Cliente } from '../models/producao.model';

@Injectable({ providedIn: 'root' })
export class ClientesService {
  private db = inject(Firestore);
  private clientesRef = collection(this.db, 'clientes');

  // A coleção 'clientes' armazena cpf apenas com dígitos (conforme cliente.model.ts)
  private soDigitos(cpf: string): string {
    return (cpf || '').replace(/\D/g, '');
  }

  buscarPorCpf(cpf: string): Observable<Cliente | null> {
    return from(this._buscar(cpf)).pipe(
      catchError(() => of(null))
    );
  }

  private async _buscar(cpf: string): Promise<Cliente | null> {
    const digits = this.soDigitos(cpf);
    if (!digits) return null;

    const snap = await getDocs(
      query(this.clientesRef, where('cpf', '==', digits))
    );

    if (snap.empty) return null;

    const d = snap.docs[0];
    const data = d.data() as any;

    return {
      id: d.id,
      nome:          data.nomeCompleto || data.nome,
      cpf:           data.cpf,
      telefone:      data.contato || data.telefone,
      email:         data.email,
      municipio:     data.cidade || data.municipio,
      estado:        data.estado,
      cep:           data.cep,
      logradouro:    data.endereco || data.logradouro,
      numero:        data.numero,
      complemento:   data.complemento,
      bairro:        data.bairro,
      dataNascimento: data.dataNascimento,
      sexo:          data.genero || data.sexo,
      status:        data.status,
    };
  }
}
