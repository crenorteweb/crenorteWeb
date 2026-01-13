import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase.config';
import type { GrupoSolidario, MembroGrupo } from '../../../models/grupo.model';

@Component({
  standalone: true,
  selector: 'app-grupo-novo',
  imports: [CommonModule, FormsModule],
  templateUrl: './grupo-novo.component.html',
  styleUrls: ['./grupo-novo.component.css'],
})
export class GrupoNovoComponent {
  // dados do formulário
  nomeGrupo = '';
  coordenadorCpf = '';
  coordenadorNome = '';
  cidade = '';
  estado = '';
  integrantes: MembroGrupo[] = [];

  // estado UI
  msg = '';
  ok = false;
  salvando = false;

  // lista de integrantes
  addIntegrante() {
    this.integrantes.push({ cpf: '', nome: '', papel: 'membro' });
  }
  removeIntegrante(i: number) {
    this.integrantes.splice(i, 1);
  }

  limpar() {
    this.nomeGrupo = '';
    this.coordenadorCpf = '';
    this.coordenadorNome = '';
    this.cidade = '';
    this.estado = '';
    this.integrantes = [];
    this.msg = '';
    this.ok = false;
  }

  private onlyDigits(v?: string) {
    return (v ?? '').replace(/\D/g, '');
  }
  private validarCpf(cpf: string) {
    const d = this.onlyDigits(cpf);
    return d.length === 11 && !/^(\d)\1{10}$/.test(d);
  }

  async salvarGrupo() {
    this.msg = '';
    this.ok = false;

    const coord = this.onlyDigits(this.coordenadorCpf);
    if (!this.validarCpf(coord)) {
      this.msg = 'CPF do coordenador inválido';
      return;
    }

    // normaliza membros (inclui coordenador)
    const membros: MembroGrupo[] = [
      {
        cpf: coord,
        nome: this.coordenadorNome.trim() || undefined,
        papel: 'coordenador',
      },
      ...this.integrantes
        .map((m) => ({
          cpf: this.onlyDigits(m.cpf),
          nome: (m.nome || '').trim() || undefined,
          papel: 'membro' as const,
        }))
        .filter((m) => this.validarCpf(m.cpf) && m.cpf !== coord),
    ];

    const payload: GrupoSolidario = {
      codigo: this.nomeGrupo.trim() || undefined,
      coordenadorCpf: coord,
      coordenadorNome: this.coordenadorNome.trim() || undefined,
      membros,
      cidade: this.cidade.trim() || undefined,
      estado: this.estado.trim() || undefined,
      status: 'em_qa',
      criadoEm: new Date(),
      criadoPorUid: 'system',    // TODO: usar usuário logado
      criadoPorNome: 'Assessor', // TODO: usar usuário logado
    };

    try {
      this.salvando = true;
      const ref = doc(db, 'grupos', coord);
      const prev = await getDoc(ref);
      if (prev.exists()) {
        payload.criadoEm = (prev.data() as any).criadoEm || payload.criadoEm;
      }
      await setDoc(ref, payload, { merge: true });

      this.ok = true;
      this.msg = '✅ Grupo criado com sucesso';
    } catch (e) {
      console.error(e);
      this.ok = false;
      this.msg = '❌ Erro ao salvar grupo';
    } finally {
      this.salvando = false;
    }
  }
}
