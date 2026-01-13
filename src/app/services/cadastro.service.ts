// src/app/services/cadastro.service.ts
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase.config';
import type { StatusCadastro, StatusEvent, Cliente } from '../models/cliente.model';

/** IMPORTANTE: use SEMPRE o id REAL do documento (doc.id). */
export type ClienteDoc = Cliente & { id: string };

/** Pequeno helper para remover undefined antes de mandar pro Firestore */
function sanitize<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const k of Object.keys(obj)) {
    const v = (obj as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Lista por status (ou todos se não passar) */
export async function listarPorStatus(status?: StatusCadastro): Promise<ClienteDoc[]> {
  const col = collection(db, 'clientes');
  const q = status ? query(col, where('status', '==', status)) : col;
  const snap = await getDocs(q as any);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
}

/** Define/atualiza o status LENDO primeiro o doc (merge manual do histórico) */
export async function setStatusClienteById(
  docId: string,
  to: StatusCadastro,
  user: { uid: string; nome?: string },
  note?: string
) {
  const ref = doc(db, 'clientes', docId);
  const snap = await getDoc(ref);
  const prev = (snap.data() || {}) as any;

  const history: StatusEvent[] = Array.isArray(prev.statusHistory) ? prev.statusHistory : [];
  const ev: StatusEvent = sanitize({
    at: new Date(),
    byUid: user.uid,
    byNome: user.nome,
    from: (prev.status as StatusCadastro) ?? 'em_analise',
    to,
    note,
  });

  await updateDoc(
    ref,
    sanitize({
      status: to,
      statusHistory: [...history, ev],
      atualizadoEm: new Date(),
    })
  );
}

/** Versão por CPF (se seus DOC IDs forem o CPF LIMPO). */
export async function setStatusClienteByCpf(
  cpf: string,
  to: StatusCadastro,
  user: { uid: string; nome?: string },
  note?: string
) {
  const docId = cpf.replace(/\D/g, ''); // normaliza para dígitos
  return setStatusClienteById(docId, to, user, note);
}

/**
 * Garante que um doc tenha status inicial “em_analise” e registra 1 evento.
 * Não sobrescreve se já tiver status.
 */
export async function ensureStatusExists(docId: string) {
  const ref = doc(db, 'clientes', docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const prev = (snap.data() || {}) as any;
  if (prev.status) return; // já tem, não altera

  const history: StatusEvent[] = Array.isArray(prev.statusHistory) ? prev.statusHistory : [];
  const baseEv: StatusEvent = sanitize({
    at: new Date(),
    byUid: 'system',
    byNome: 'Backfill',
    from: undefined, // omitido no sanitize
    to: 'em_analise' as StatusCadastro,
    note: 'Status inicial definido automaticamente.',
  });

  await updateDoc(
    ref,
    sanitize({
      status: 'em_analise' as StatusCadastro,
      statusHistory: [...history, baseEv],
      atualizadoEm: new Date(),
    })
  );
}

/**
 * Migra todos os docs SEM status para “em_analise”.
 * Você chama isso a partir da sua lista (botão Migrar).
 */
export async function migrarStatusEmLote(clientes: { id: string }[]) {
  const chunk = 40;
  for (let i = 0; i < clientes.length; i += chunk) {
    await Promise.all(clientes.slice(i, i + chunk).map((c) => ensureStatusExists(c.id)));
  }
}

/* =======================================================================
   🔽 Funções de listagem/CRUD para a lista de cadastros completos
   ======================================================================= */

/**
 * Lista os cadastros criados por um assessor específico (createdByUid).
 * Tenta ordenar por createdAt desc (requer índice composto).
 * Se o índice não existir, faz fallback para orderBy('__name__', 'desc').
 */
export async function listarDoAssessor(uid: string, max: number = 500): Promise<ClienteDoc[]> {
  const col = collection(db, 'clientes');

  try {
    const q = query(
      col,
      where('createdByUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(max)
    );
    const snap = await getDocs(q as any);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
  } catch (err: any) {
    console.warn(
      '[Cadastros] Índice composto (createdByUid + createdAt) ausente, usando fallback por __name__:',
      err?.message || err
    );
    const qFallback = query(
      col,
      where('createdByUid', '==', uid),
      orderBy('__name__', 'desc'),
      limit(max)
    );
    const snap = await getDocs(qFallback as any);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
  }
}

/** Atualiza parcialmente um cadastro (por ID real do doc) */
export async function atualizarCliente(id: string, patch: Partial<Cliente>) {
  const ref = doc(db, 'clientes', id);
  await updateDoc(ref, sanitize({ ...patch, atualizadoEm: new Date() }) as any);
}

/** Remove um cadastro (por ID real do doc) */
export async function removerCliente(id: string) {
  const ref = doc(db, 'clientes', id);
  await deleteDoc(ref);
}

/**
 * Lista por assessor + status simultaneamente.
 * Tenta ordenar por createdAt desc (exige índice composto em 3 campos).
 * Se não houver índice, cai no fallback por __name__.
 */
export async function listarDoAssessorPorStatus(
  uid: string,
  status: StatusCadastro,
  max: number = 500
): Promise<ClienteDoc[]> {
  const col = collection(db, 'clientes');

  try {
    const q = query(
      col,
      where('createdByUid', '==', uid),
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
      limit(max)
    );
    const snap = await getDocs(q as any);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
  } catch (err: any) {
    console.warn(
      '[Cadastros] Índice composto (createdByUid + status + createdAt) ausente, usando fallback por __name__:',
      err?.message || err
    );
    const qFallback = query(
      col,
      where('createdByUid', '==', uid),
      where('status', '==', status),
      orderBy('__name__', 'desc'),
      limit(max)
    );
    const snap = await getDocs(qFallback as any);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
  }
}

/* =======================================================================
   📌 Observações
   - Para performance/ordenação consistente, crie os índices no Firestore:
     1) createdByUid (ASC) + createdAt (DESC)   [scope: Collection]
     2) createdByUid (ASC) + status (ASC) + createdAt (DESC)   [scope: Collection]
   - Garanta que você está salvando `createdAt` (serverTimestamp()) e `createdByUid`
     nos docs da coleção `clientes` no momento do cadastro.
   ======================================================================= */
