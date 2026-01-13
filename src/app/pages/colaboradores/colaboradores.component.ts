import {
  Component, ElementRef, ViewChild, inject, signal,
  OnInit, OnDestroy, AfterViewInit, Pipe, PipeTransform
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

// Firebase
import { db } from '../../firebase.config';
import {
  collection, query, orderBy, onSnapshot, Unsubscribe,
  doc, updateDoc, deleteDoc
} from 'firebase/firestore';

// Firebase Storage (mesma instância)
import { FirebaseStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage as fbStorage } from '../../firebase.config';

declare const bootstrap: any;

// ==== Ajuste aqui se sua coleção tiver outro nome (ex.: 'usuarios') ====
const COLLECTION = 'colaboradores';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';

type Status = 'ativo' | 'inativo';

export type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  rota: string;
  status: Status;
  photoURL?: string | null;
  supervisorId?: string | null;
  analistaId?: string | null;
  cpf?: string | null;
  telefone?: string | null;
  criadoEm?: number;
};

// Pipe simples só para exibir CPF com máscara na tabela
@Pipe({ name: 'cpfMask', standalone: true })
export class CpfMaskPipe implements PipeTransform {
  transform(v: string | null | undefined) {
    const s = (v ?? '').replace(/\D/g, '');
    if (s.length !== 11) return v ?? '';
    return `${s.substring(0,3)}.${s.substring(3,6)}.${s.substring(6,9)}-${s.substring(9)}`;
  }
}

// Validador de telefone (BR: 10 ou 11 dígitos)
const TEL_REGEX = /^\d{10,11}$/;

@Component({
  standalone: true,
  selector: 'app-colaboradores',
  imports: [CommonModule, ReactiveFormsModule, FormsModule, CpfMaskPipe],
  templateUrl: './colaboradores.component.html',
  styleUrls: ['./colaboradores.component.css']
})
export class ColaboradoresComponent implements OnInit, OnDestroy, AfterViewInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private storage: FirebaseStorage = fbStorage;

  // Estados
  loading = signal(false);       // criação
  loadingList = signal(false);   // listagem
  savingEdit = signal(false);    // edição
  erro = signal<string | null>(null);
  ok = signal<string | null>(null);

  // Preview
  private fotoFile: File | null = null;
  fotoPreview = signal<string | null>(null);

  // Busca
  busca = '';
  private all = signal<Colaborador[]>([]);
  filtrados = signal<Colaborador[]>([]);

  // Derivados (responsáveis)
  supervisorsAtivos = signal<Colaborador[]>([]);
  analistasAtivos = signal<Colaborador[]>([]);

  // Firestore unsub
  private unsub?: Unsubscribe;

  // Modal edição
  @ViewChild('editModal', { static: false }) editModalRef?: ElementRef;
  private editModal?: any;
  private editId: string | null = null;

  // ---------- Forms ----------
  // CRIAÇÃO (continua validando como antes)
  form = this.fb.group({
    nome: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
    cpf: ['', [Validators.required, Validators.pattern(/^\d{11}$/)]],
    telefone: ['', [Validators.pattern(TEL_REGEX)]],
    papel: ['assessor' as Papel, Validators.required],
    cargo: [''],
    status: ['ativo' as Status, Validators.required],
    rota: ['', Validators.required],
    supervisorId: [null as string | null],
    analistaId: [null as string | null],
  });

  // EDIÇÃO (BEM ABERTA: sem required; só atualiza o que vier preenchido)
  editForm = this.fb.group({
    nome: [''],
    email: [{ value: '', disabled: true }],
    cpf: [''],                          // validarei só se vier preenchido
    telefone: ['', [Validators.pattern(TEL_REGEX)]],
    papel: ['assessor' as Papel],
    cargo: [''],
    status: ['ativo' as Status],
    rota: [''],
    supervisorId: [null as string | null],
    analistaId: [null as string | null],
  });

  // ---------- Lifecycle ----------
  ngOnInit(): void {
    this.carregarLista();
  }

  ngAfterViewInit(): void {
    if (this.editModalRef?.nativeElement) {
      this.editModal = new bootstrap.Modal(this.editModalRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (this.unsub) this.unsub();
  }

  // ---------- Listagem ----------
  private carregarLista() {
    this.loadingList.set(true);
    const q = query(collection(db, COLLECTION), orderBy('nome'));
    this.unsub = onSnapshot(q, (snap) => {
      const rows: Colaborador[] = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<Colaborador, 'id'>),
      }));
      this.all.set(rows);

      // popula listas de responsáveis ativos
      this.supervisorsAtivos.set(rows.filter(r => r.papel === 'supervisor' && r.status === 'ativo'));
      this.analistasAtivos.set(rows.filter(r => r.papel === 'analista' && r.status === 'ativo'));

      this.aplicarBusca();
      this.loadingList.set(false);
    }, (err) => {
      console.error(err);
      this.erro.set('Falha ao carregar colaboradores.');
      this.loadingList.set(false);
    });
  }

  aplicarBusca() {
    const term = (this.busca || '').trim().toLowerCase();
    if (!term) {
      this.filtrados.set(this.all());
      return;
    }
    this.filtrados.set(
      this.all().filter(c => {
        const sup = c.supervisorId ? this.nomePorId(c.supervisorId) : '';
        const ana = c.analistaId ? this.nomePorId(c.analistaId) : '';
        const blob = `${c.nome} ${c.email} ${c.cpf ?? ''} ${c.telefone ?? ''} ${c.rota ?? ''} ${sup} ${ana}`.toLowerCase();
        return blob.includes(term);
      })
    );
  }

  // ---------- Helpers ----------
  nomePorId(id: string | null | undefined): string {
    if (!id) return '';
    const found = this.all().find(p => p.id === id);
    return found?.nome ?? '';
  }

  // ---------- Upload foto ----------
  onFotoChange(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const f = input.files?.[0] || null;
    this.fotoFile = f ?? null;
    if (f) {
      const reader = new FileReader();
      reader.onload = () => this.fotoPreview.set(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      this.fotoPreview.set(null);
    }
  }

  private async uploadFotoSeHouver(): Promise<string | null> {
    if (!this.fotoFile) return null;
    const safeName = (this.fotoFile.name || 'avatar').replace(/[^\w.\-]/g, '_');
    const path = `colaboradores/avatars/${Date.now()}-${safeName}`;
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, this.fotoFile, { contentType: this.fotoFile.type || 'image/jpeg' });
    return await getDownloadURL(storageRef);
  }

  // ---------- Validações (criação) ----------
  cpfErro(): string | null {
    const c = this.form.get('cpf');
    if (!c || !c.touched) return null;
    const raw = String(c.value || '').replace(/\D/g, '');
    if (!raw) return 'CPF é obrigatório.';
    if (!/^\d{11}$/.test(raw)) return 'Informe 11 dígitos.';
    if (!this.validarCPF(raw)) return 'CPF inválido.';
    return null;
  }

  private validarCPF(cpf: string): boolean {
    if (!cpf || cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0, resto: number;
    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10), 10)) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf.substring(10, 11), 10);
  }

  private validarResponsaveisSeAssessor(papel: Papel, supervisorId: string | null, analistaId: string | null) {
    if (papel !== 'assessor') return null;
    if (!supervisorId) return 'Selecione um Supervisor responsável para o assessor.';
    if (!analistaId) return 'Selecione um Analista responsável para o assessor.';
    return null;
  }

  // ---------- Criar ----------
  async criar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.value as any;
    const cpfDigits = String(v.cpf || '').replace(/\D/g, '');
    if (!this.validarCPF(cpfDigits)) {
      this.form.get('cpf')?.markAsTouched();
      this.erro.set('CPF inválido.');
      return;
    }

    const telDigits = String(v.telefone || '').replace(/\D/g, '');
    if (telDigits && !TEL_REGEX.test(telDigits)) {
      this.erro.set('Telefone inválido. Informe 10 ou 11 dígitos.');
      return;
    }

    const respErr = this.validarResponsaveisSeAssessor(v.papel, v.supervisorId, v.analistaId);
    if (respErr) {
      this.erro.set(respErr);
      return;
    }

    this.loading.set(true);
    this.erro.set(null);
    this.ok.set(null);

    try {
      const photoURL = await this.uploadFotoSeHouver();

      await this.auth.criarColaborador(v.email, v.senha, {
        nome: v.nome,
        email: v.email,
        papel: v.papel,
        cargo: v.cargo ?? null,
        rota: v.rota,                 // obrigatório
        status: v.status,
        cpf: cpfDigits,
        telefone: telDigits || null,
        photoURL: photoURL ?? null,
        supervisorId: v.supervisorId ?? null,
        analistaId: v.analistaId ?? null,
      });

      this.ok.set('Colaborador criado com sucesso!');
      this.form.reset({
        papel: 'assessor',
        status: 'ativo',
        rota: '',
        supervisorId: null,
        analistaId: null,
      });
      this.fotoPreview.set(null);
      this.fotoFile = null;
    } catch (e: any) {
      console.error(e);
      this.erro.set(e?.message ?? 'Falha ao criar colaborador');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- Edição ----------
  abrirEdicao(c: Colaborador) {
    this.editId = c.id;
    this.editForm.reset({
      nome: c.nome,
      email: c.email,
      cpf: c.cpf ?? '',
      telefone: c.telefone ?? '',
      papel: c.papel,
      cargo: c.cargo ?? '',
      status: c.status,
      rota: c.rota ?? '',
      supervisorId: c.supervisorId ?? null,
      analistaId: c.analistaId ?? null,
    });
    this.savingEdit.set(false);
    this.erro.set(null);
    this.ok.set(null);
    this.editModal?.show();
  }

  fecharEdicao() {
    this.editModal?.hide();
    this.editId = null;
  }

  async salvarEdicao() {
    if (!this.editId) return;

    // Monta apenas os campos presentes/alterados
    const updates: any = {};

    const nome = this.editForm.get('nome')?.value?.toString().trim();
    if (nome !== undefined && nome !== null && nome !== '') updates.nome = nome;

    const papel = this.editForm.get('papel')?.value as Papel | undefined;
    if (papel) updates.papel = papel;

    const cargo = this.editForm.get('cargo')?.value;
    if (cargo !== undefined) updates.cargo = cargo === '' ? null : cargo;

    const status = this.editForm.get('status')?.value as Status | undefined;
    if (status) updates.status = status;

    const rota = this.editForm.get('rota')?.value;
    if (rota !== undefined) updates.rota = rota; // pode ser string vazia

    const supervisorId = this.editForm.get('supervisorId')?.value as string | null | undefined;
    if (supervisorId !== undefined) updates.supervisorId = supervisorId;

    const analistaId = this.editForm.get('analistaId')?.value as string | null | undefined;
    if (analistaId !== undefined) updates.analistaId = analistaId;

    // CPF (só valida se veio algo)
    const cpfRaw = this.editForm.get('cpf')?.value ?? '';
    const cpfDigits = String(cpfRaw).replace(/\D/g, '');
    if (cpfRaw !== '' && cpfDigits !== '') {
      if (this.validarCPF(cpfDigits)) {
        updates.cpf = cpfDigits;
      } else {
        console.warn('[editar] CPF inválido — ignorando atualização de CPF');
      }
    } else if (cpfRaw === '') {
      // Se o usuário limpou o campo, podemos opcionalmente limpar no doc:
      // updates.cpf = null;
    }

    // Telefone (só valida se veio algo)
    const telRaw = this.editForm.get('telefone')?.value ?? '';
    const telDigits = String(telRaw).replace(/\D/g, '');
    if (telRaw !== '' && telDigits !== '') {
      if (TEL_REGEX.test(telDigits)) {
        updates.telefone = telDigits;
      } else {
        console.warn('[editar] Telefone inválido — ignorando atualização de telefone');
      }
    } else if (telRaw === '') {
      // idem: pode limpar se quiser
      // updates.telefone = null;
    }

    // Não travar por responsáveis ausentes no modo edição
    // (Se quiser aplicar regra quando papel === 'assessor', faça aqui,
    // mas a ideia agora é ficar aberto.)
    try {
      this.savingEdit.set(true);
      this.erro.set(null);
      this.ok.set(null);

      if (Object.keys(updates).length === 0) {
        this.ok.set('Nada para atualizar.');
        this.fecharEdicao();
        return;
      }

      await updateDoc(doc(db, COLLECTION, this.editId), updates);
      this.ok.set('Colaborador atualizado.');
      this.fecharEdicao();
    } catch (e: any) {
      console.error(e);
      this.erro.set(e?.message ?? 'Falha ao salvar edição');
    } finally {
      this.savingEdit.set(false);
    }
  }

  // ---------- Excluir ----------
  async excluir(c: Colaborador) {
    if (!confirm(`Excluir o colaborador "${c.nome}"? Essa ação não pode ser desfeita.`)) return;

    this.savingEdit.set(true);
    this.erro.set(null);
    this.ok.set(null);
    try {
      await deleteDoc(doc(db, COLLECTION, c.id));
      this.ok.set('Colaborador excluído.');
      // Para bloquear acesso, desative/exclua o usuário no Firebase Auth via backend/Admin SDK.
    } catch (e: any) {
      console.error(e);
      this.erro.set(e?.message ?? 'Falha ao excluir colaborador');
    } finally {
      this.savingEdit.set(false);
    }
  }
}
