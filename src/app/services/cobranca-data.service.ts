import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  setDoc,
  collection,
  writeBatch,
  getDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
} from '@angular/fire/firestore';

import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { GrupoDoc, IntegranteDoc, ParcelaDoc } from '../models/cobranca.model';

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (v && typeof v === 'object' && 'toDate' in (v as any)) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  try {
    const d = new Date(v as any);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class CobrancaDataService {
  constructor(private afs: Firestore) {}

  // Refs
  contratoRef(contratoId: string) {
    return doc(this.afs, `contratos/${contratoId}`);
  }
  integrantesCol(contratoId: string) {
    return collection(this.afs, `contratos/${contratoId}/integrantes`);
  }
  parcelasCol(contratoId: string) {
    return collection(this.afs, `contratos/${contratoId}/parcelas`);
  }

  // CRUD Grupo
  async upsertContrato(input: Partial<GrupoDoc> & { numeroContrato: string }) {
    const id = (input.id ?? input.numeroContrato).toString();
    const ref = this.contratoRef(id);
    const snap = await getDoc(ref);

    await setDoc(
      ref,
      {
        id,
        numeroContrato: input.numeroContrato,
        nomeGrupo: input.nomeGrupo ?? null,
        operador: input.operador ?? null,
        dataLiberacao: input.dataLiberacao ?? null,
        cidade: input.cidade ?? null,
        uf: input.uf ?? null,

        // 🔽 novos campos do model
        numeroProposta: input.numeroProposta ?? null,
        unidade: input.unidade ?? null,
        nomesMembros: input.nomesMembros ?? null,
        numeroMembros: input.numeroMembros ?? null,
        dataVencimentoProposta: input.dataVencimentoProposta ?? null,
        dataConclusaoProposta: input.dataConclusaoProposta ?? null,
        valorParcelaIndividual: input.valorParcelaIndividual ?? null,
        valorParcelaGrupo: input.valorParcelaGrupo ?? null,
        valorTotalProposta: input.valorTotalProposta ?? null,
        situacao: input.situacao ?? null,

        createdAt: snap.exists()
          ? (snap.data() as any).createdAt
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return id;
  }

  async setDataLiberacao(
    contratoId: string,
    data: Date | string | Timestamp | null
  ) {
    const ref = this.contratoRef(contratoId);
    let ts: Timestamp | null = null;
    if (data) {
      const d = data instanceof Timestamp ? data.toDate() : toDateSafe(data);
      if (!d) throw new Error('Data de liberação inválida');
      ts = Timestamp.fromDate(d);
    }
    await updateDoc(ref, { dataLiberacao: ts, updatedAt: serverTimestamp() });
  }

  // 🔽 NOVO: Data de vencimento da proposta
  async setDataVencimentoProposta(
    contratoId: string,
    data: Date | string | Timestamp | null
  ) {
    const ref = this.contratoRef(contratoId);
    let ts: Timestamp | null = null;
    if (data) {
      const d = data instanceof Timestamp ? data.toDate() : toDateSafe(data);
      if (!d) throw new Error('Data de vencimento da proposta inválida');
      ts = Timestamp.fromDate(d);
    }
    await updateDoc(ref, {
      dataVencimentoProposta: ts,
      updatedAt: serverTimestamp(),
    });
  }

  // 🔽 NOVO: Data de conclusão da proposta
  async setDataConclusaoProposta(
    contratoId: string,
    data: Date | string | Timestamp | null
  ) {
    const ref = this.contratoRef(contratoId);
    let ts: Timestamp | null = null;
    if (data) {
      const d = data instanceof Timestamp ? data.toDate() : toDateSafe(data);
      if (!d) throw new Error('Data de conclusão da proposta inválida');
      ts = Timestamp.fromDate(d);
    }
    await updateDoc(ref, {
      dataConclusaoProposta: ts,
      updatedAt: serverTimestamp(),
    });
  }

  // Leitura básica
  // Lista contratos (com id garantido) e ordenados por numeroContrato
  async listContratos(): Promise<GrupoDoc[]> {
    const q = query(collection(this.afs, 'contratos'), orderBy('numeroContrato'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: data?.id ?? d.id,
        numeroContrato: data?.numeroContrato ?? d.id,
        nomeGrupo: data?.nomeGrupo ?? null,
        operador: data?.operador ?? null,
        cidade: data?.cidade ?? null,
        uf: data?.uf ?? null,
        dataLiberacao: data?.dataLiberacao ?? null,

        // novos campos
        numeroProposta: data?.numeroProposta ?? null,
        unidade: data?.unidade ?? null,
        nomesMembros: data?.nomesMembros ?? null,
        numeroMembros: data?.numeroMembros ?? null,
        dataVencimentoProposta: data?.dataVencimentoProposta ?? null,
        dataConclusaoProposta: data?.dataConclusaoProposta ?? null,
        valorParcelaIndividual: data?.valorParcelaIndividual ?? null,
        valorParcelaGrupo: data?.valorParcelaGrupo ?? null,
        valorTotalProposta: data?.valorTotalProposta ?? null,
        situacao: data?.situacao ?? null,

        createdAt: data?.createdAt ?? null,
        updatedAt: data?.updatedAt ?? null,
      } as GrupoDoc;
    });
  }

  async listIntegrantes(contratoId: string): Promise<IntegranteDoc[]> {
    const snap = await getDocs(this.integrantesCol(contratoId));
    return snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as any) }) as IntegranteDoc
    );
  }

  async listParcelas(contratoId: string): Promise<ParcelaDoc[]> {
    const snap = await getDocs(this.parcelasCol(contratoId));
    return snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as any) }) as ParcelaDoc
    );
  }

  // CRUD Integrante
  async upsertIntegrante(
    contratoId: string,
    integrante: Partial<IntegranteDoc> & { nome: string; id?: string }
  ) {
    const col = this.integrantesCol(contratoId);
    const id = integrante.id || crypto.randomUUID();
    const ref = doc(col, id);
    const now = serverTimestamp();
    await setDoc(
      ref,
      {
        id,
        nome: integrante.nome,
        valorIndividual: integrante.valorIndividual ?? null,
        telefone1: integrante.telefone1 ?? null,
        telefone2: integrante.telefone2 ?? null,
        statusFlag: integrante.statusFlag ?? null,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
    return id;
  }

  // CRUD Parcela
  async upsertParcela(
    contratoId: string,
    parcela: Partial<Omit<ParcelaDoc, 'vencimento' | 'id'>> & {
      id?: string;
      parcela: number;
      valorParcela: number;
      vencimento: string | Date | Timestamp;
      pago?: boolean;
    }
  ) {
    const col = this.parcelasCol(contratoId);
    const id = parcela.id || String(parcela.parcela);
    const ref = doc(col, id);

    const d =
      parcela.vencimento instanceof Timestamp
        ? parcela.vencimento.toDate()
        : toDateSafe(parcela.vencimento);
    if (!d) throw new Error('Data de vencimento inválida');

    const vencTS = Timestamp.fromDate(d);
    const now = serverTimestamp();

    await setDoc(
      ref,
      {
        id,
        parcela: Number(parcela.parcela),
        valorParcela: Number(parcela.valorParcela),
        vencimento: vencTS,
        pago: parcela.pago ?? false,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    return id;
  }

  async setPago(contratoId: string, parcelaId: string, pago: boolean) {
    const ref = doc(this.afs, `contratos/${contratoId}/parcelas/${parcelaId}`);
    await updateDoc(ref, { pago, updatedAt: serverTimestamp() });
  }

  // Seed completo (opcional)
  async createContratoCompleto(
    grupo: {
      numeroContrato: string;
      nomeGrupo?: string | null;
      dataLiberacao?: Date | string | null;
      operador?: string | null;
      cidade?: string | null;
      uf?: string | null;

      // novos campos opcionais
      numeroProposta?: string | null;
      unidade?: string | null;
      nomesMembros?: string | null;
      numeroMembros?: number | null;
      dataVencimentoProposta?: Date | string | Timestamp | null;
      dataConclusaoProposta?: Date | string | Timestamp | null;
      valorParcelaIndividual?: number | null;
      valorParcelaGrupo?: number | null;
      valorTotalProposta?: number | null;
      situacao?: string | null;
    },
    integrantes: Array<
      Omit<IntegranteDoc, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
    >,
    parcelas: Array<
      Omit<ParcelaDoc, 'id' | 'vencimento' | 'createdAt' | 'updatedAt'> & {
        id?: string;
        vencimento: string | Date | Timestamp;
      }
    >
  ) {
    const contratoId = grupo.numeroContrato.toString();
    const batch = writeBatch(this.afs);

    const contratoRef = this.contratoRef(contratoId);

    // datas
    let dataLibTS: Timestamp | null = null;
    if (grupo.dataLiberacao) {
      const d = toDateSafe(grupo.dataLiberacao);
      dataLibTS = d ? Timestamp.fromDate(d) : null;
    }

    let dataVencPropTS: Timestamp | null = null;
    if (grupo.dataVencimentoProposta) {
      const d =
        grupo.dataVencimentoProposta instanceof Timestamp
          ? grupo.dataVencimentoProposta.toDate()
          : toDateSafe(grupo.dataVencimentoProposta);
      dataVencPropTS = d ? Timestamp.fromDate(d) : null;
    }

    let dataConcPropTS: Timestamp | null = null;
    if (grupo.dataConclusaoProposta) {
      const d =
        grupo.dataConclusaoProposta instanceof Timestamp
          ? grupo.dataConclusaoProposta.toDate()
          : toDateSafe(grupo.dataConclusaoProposta);
      dataConcPropTS = d ? Timestamp.fromDate(d) : null;
    }

    batch.set(
      contratoRef,
      {
        id: contratoId,
        numeroContrato: contratoId,
        nomeGrupo: grupo.nomeGrupo ?? null,
        operador: grupo.operador ?? null,
        cidade: grupo.cidade ?? null,
        uf: grupo.uf ?? null,
        dataLiberacao: dataLibTS,

        numeroProposta: grupo.numeroProposta ?? null,
        unidade: grupo.unidade ?? null,
        nomesMembros: grupo.nomesMembros ?? null,
        numeroMembros: grupo.numeroMembros ?? null,
        dataVencimentoProposta: dataVencPropTS,
        dataConclusaoProposta: dataConcPropTS,
        valorParcelaIndividual: grupo.valorParcelaIndividual ?? null,
        valorParcelaGrupo: grupo.valorParcelaGrupo ?? null,
        valorTotalProposta: grupo.valorTotalProposta ?? null,
        situacao: grupo.situacao ?? null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const intsColPath = `contratos/${contratoId}/integrantes`;
    for (const i of integrantes) {
      const iid = i.id || crypto.randomUUID();
      const iRef = doc(this.afs, `${intsColPath}/${iid}`);
      batch.set(
        iRef,
        {
          id: iid,
          nome: i.nome,
          valorIndividual: i.valorIndividual ?? null,
          telefone1: i.telefone1 ?? null,
          telefone2: i.telefone2 ?? null,
          statusFlag: i.statusFlag ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    const parColPath = `contratos/${contratoId}/parcelas`;
    for (const p of parcelas) {
      const pid = p.id || String(p.parcela);
      const pRef = doc(this.afs, `${parColPath}/${pid}`);
      const d =
        p.vencimento instanceof Timestamp
          ? p.vencimento.toDate()
          : toDateSafe(p.vencimento);
      if (!d) throw new Error(`Vencimento inválido na parcela ${p.parcela}`);
      batch.set(
        pRef,
        {
          id: pid,
          parcela: p.parcela,
          valorParcela: p.valorParcela,
          vencimento: Timestamp.fromDate(d),
          pago: !!p.pago,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    return contratoId;
  }
}
