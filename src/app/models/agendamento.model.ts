import { Timestamp } from '@angular/fire/firestore';

export interface Agendamento {
  id?: string;

  preCadastroId: string;

  clienteNome: string | null;
  clienteCpf?: string | null;
  clienteTelefone?: string | null;
  clienteEmail?: string | null;
  clienteEndereco?: string | null;
  clienteBairro?: string | null;

  dataHora: Timestamp;

  assessorUid: string;
  assessorNome?: string | null;

  createdByUid?: string;
  createdAt?: Timestamp;

  /** Status sincronizado com o pré-cadastro */
  status?: 'agendado' | 'visitado' | 'nao_agendado';
}
