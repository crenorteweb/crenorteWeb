import {
  collection, addDoc, getDocs, query, where, orderBy, doc,
  getDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../firebase.config';
import type { GrupoSolidario, StatusGrupo, MembroGrupo } from '../models/grupo.model';
import type { Cliente } from '../models/cliente.model';

const COL = 'gruposSolidarios';

export async function criarGrupoAPartirDoCadastro(
  clienteId: string,             // id do doc em /clientes (no seu caso é o CPF docId)
  metaUser: { uid: string; nome?: string; }
) {
  // Carrega cliente para preencher coordenador
  const cRef = doc(db, 'clientes', clienteId);
  const cSnap = await getDoc(cRef);
  if (!cSnap.exists()) throw new Error('Cadastro não encontrado para criar grupo.');
  const c = cSnap.data() as Cliente;

  const coordenadorCpf = (c?.cpf || clienteId).replace(/\D/g, '');
  const coordenadorNome = c?.nomeCompleto || '';
  const cidade = (c as any)?.cidade || '';
  const estado = (c as any)?.estado || '';

  const membros: MembroGrupo[] = [{
    cpf: coordenadorCpf,
    nome: coordenadorNome,
    papel: 'coordenador',
    cadastroId: clienteId,
    valorSolicitado: Number((c as any)?.valorSolicitado || 0),
  }];

  const totalSolicitado = membros.reduce((acc, m) => acc + (m.valorSolicitado || 0), 0);

  const payload: GrupoSolidario = {
    coordenadorCpf,
    coordenadorNome,
    cidade,
    estado,
    membros,
    status: 'em_qa',
    statusHistory: [{
      at: new Date(),
      byUid: metaUser.uid,
      byNome: metaUser.nome,
      to: 'em_qa',
      note: 'Grupo criado a partir de cadastro aprovado',
    }],
    criadoEm: new Date(),
    criadoPorUid: metaUser.uid,
    criadoPorNome: metaUser.nome,
    totalSolicitado,
  };

  const ref = await addDoc(collection(db, COL), payload as any);
  return { id: ref.id, ...payload };
}

export async function listarGrupos(status?: StatusGrupo) {
  const col = collection(db, COL);
  let q = query(col, orderBy('criadoEm', 'desc'));
  if (status) q = query(col, where('status', '==', status), orderBy('criadoEm', 'desc')) as any;
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })) as GrupoSolidario[];
}

export async function setStatusGrupo(
  grupoId: string,
  to: StatusGrupo,
  user: { uid: string; nome?: string },
  note?: string
) {
  const ref = doc(db, COL, grupoId);
  const snap = await getDoc(ref);
  const prev = snap.data() || {};
  const hist = (prev as any).statusHistory || [];
  const ev = {
    at: new Date(),
    byUid: user.uid,
    byNome: user.nome,
    from: (prev as any).status || 'em_qa',
    to,
    note,
  };
  await updateDoc(ref, {
    status: to,
    statusHistory: [...hist, ev],
  });
}

export function exportGrupoParaCSV(grupo: GrupoSolidario): string {
  const header = ['Papel','CPF','Nome','ValorSolicitado','Cidade','Estado'].join(';');
  const rows = (grupo.membros || []).map(m => [
    m.papel, m.cpf, (m.nome||''), (m.valorSolicitado||0),
    grupo.cidade||'', grupo.estado||''
  ].join(';'));
  return [header, ...rows].join('\n');
}
