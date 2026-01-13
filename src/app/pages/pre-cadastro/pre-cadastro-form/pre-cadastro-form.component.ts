import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  OnInit,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { PreCadastro } from '../../../models/pre-cadastro.model';
import { HeaderComponent } from '../../shared/header/header.component';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';

declare const bootstrap: any;

type Star = 1 | 2 | 3 | 4 | 5;
type MaskedNumber = string | null;

type FeedbackCliente = {
  notaAtendimento: Star;
  cordialidade: Star;
  clareza: Star;
  recebeuInformacoesCompletas: boolean;
  recomendaria: boolean;
  comentarios?: string;
};

type FluxoFixos = {
  aluguel: number;
  salarios: number;
  energiaEletrica: number;
  agua: number;
  telefoneInternet: number;
};
type FluxoVariaveis = {
  materiaPrima: number;
  insumos: number;
  frete: number;
  transporte: number;
  outros: Array<{ nome: string; valor: number }>;
};
type FluxoCaixa = {
  faturamentoMensal: number;
  fixos: FluxoFixos;
  variaveis: FluxoVariaveis;
};
type FluxoTotais = { receita: number; custos: number; lucro: number };

@Component({
  selector: 'app-pre-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, NgxMaskDirective],
  templateUrl: './pre-cadastro-form.component.html',
  styleUrls: ['./pre-cadastro-form.component.css'],
  providers: [provideNgxMask()],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PreCadastroFormComponent implements OnInit, OnDestroy {
  private _cpfCleanup?: () => void;

  ngOnDestroy(): void {
    this._cpfCleanup?.();
  }

  private service = inject(PreCadastroService);
  public router = inject(Router);
  private route = inject(ActivatedRoute);
  private afs = inject(Firestore);

  @ViewChild('feedbackModal', { static: false }) feedbackModalRef?: ElementRef<HTMLDivElement>;
  private feedbackModal?: any;

  /** Modal Fluxo de Caixa por template-ref (estável) */
  @ViewChild('fluxoModalEl', { static: false }) fluxoModalEl?: ElementRef<HTMLDivElement>;
  private fluxoModalRef: any | null = null;

  loading = signal(false);

  // mensagens de feedback (sucesso/erro)
  msg = signal<string | null>(null);
  msgType = signal<'success' | 'danger' | 'info' | null>(null);
  private showMsg(type: 'success' | 'danger' | 'info', text: string, autoHideMs = 4000) {
    this.msgType.set(type);
    this.msg.set(text);
    if (autoHideMs > 0) {
      setTimeout(() => {
        this.msg.set(null);
        this.msgType.set(null);
      }, autoHideMs);
    }
  }

  // ===== Edição =====
  editMode = false;
  private docPath: string | null = null;
  private docId: string | null = null;

  // NOVO: lista de UFs para o select
  ufsBrasil: string[] = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];

  // NOVO: acrescentei cidade e uf ao model
  model: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome'> & {
    cidade?: string;
    uf?: string;
  } = {
      nomeCompleto: '',
      cpf: '',
      endereco: '',
      telefone: '',
      email: '',
      bairro: '',
      origem: '',
      cidade: '',
      uf: '',
    };

  private lastPreCadastroId: string | null = null;

  // ===================== FINANCEIRO =====================
  jurosMes = 0.0274; // 2,74% a.m.
  parcelas: number[] = Array.from({ length: 12 }, (_, i) => i + 1);

  /** Campo mascarado (string) + número parseado */
  valorSolicitadoMasked: MaskedNumber = '';
  valorSolicitadoNumber = 0;

  /** Select de parcelas */
  parcelasSelecionadas: number | null = null;

  parcelasComValor: { n: number; label: string; valorParcela: number }[] = [];
  resumoParcela = '';

  // ===== Fluxo de Caixa =====
  fluxoCaixa: FluxoCaixa | null = {
    faturamentoMensal: 0,
    fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
    variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
  };
  fluxoCaixaTotais: FluxoTotais = { receita: 0, custos: 0, lucro: 0 };

  // Form do modal (espelha o cadastro-form)
  fluxoForm = {
    faturamentoMensal: 0,
    fixos: {
      aluguelMasked: '' as MaskedNumber,
      salariosMasked: '' as MaskedNumber,
      energiaEletricaMasked: '' as MaskedNumber,
      aguaMasked: '' as MaskedNumber,
      telefoneInternetMasked: '' as MaskedNumber,

      aluguel: 0,
      salarios: 0,
      energiaEletrica: 0,
      agua: 0,
      telefoneInternet: 0,
    },
    variaveis: {
      materiaPrimaMasked: '' as MaskedNumber,
      insumosMasked: '' as MaskedNumber,
      freteMasked: '' as MaskedNumber,
      transporteMasked: '' as MaskedNumber,

      materiaPrima: 0,
      insumos: 0,
      frete: 0,
      transporte: 0,

      outros: [] as Array<{ nome: string; valorMasked: MaskedNumber; valor: number }>,
    },
  };

  // ====== Faturamento (campo integer com mask .0) ======
  faturamento = 0;
  faturamentoInput = '';

  // ================== FEEDBACK ==================
  feedback: FeedbackCliente = {
    notaAtendimento: 5,
    cordialidade: 5,
    clareza: 5,
    recebeuInformacoesCompletas: true,
    recomendaria: true,
    comentarios: '',
  };
  stars: Star[] = [1, 2, 3, 4, 5];

  // ===== Utils =====
  private limpar(str: string) {
    return (str || '').trim();
  }

  // ===== Moeda (iguais ao cadastro-form) =====
  parseMoedaBR(v: any): number {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const s = String(v).replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }
  parseBRN(masked: string | null | undefined): number {
    if (!masked) return 0;
    let s = String(masked).replace(/[^\d,]/g, '');
    const partes = s.split(',');
    if (partes.length > 1) {
      const dec = partes.pop();
      s = partes.join('') + '.' + dec;
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  formatBRL(v: number): string {
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  formatBRN(n: number): string {
    try {
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch {
      return `R$ ${(+n || 0).toFixed(2)}`;
    }
  }

  /** ========= MÁSCARA/VALIDAÇÃO CPF (robusta) ========= */
  private inicializarMascaraCPF(): () => void {
    let el = document.querySelector('input[name="cpf"]') as HTMLInputElement | null;
    if (!el) {
      const tries = 15;
      let count = 0;
      const iv = setInterval(() => {
        el = document.querySelector('input[name="cpf"]') as HTMLInputElement | null;
        if (el || ++count >= tries) {
          clearInterval(iv);
          if (el) this._cpfCleanup = this._wireCpf(el!);
        }
      }, 100);
      return () => { };
    } else {
      return this._wireCpf(el);
    }
  }

  private _wireCpf(el: HTMLInputElement): () => void {
    const normalizeUnicode = (v: string) =>
      (v ?? '')
        .toString()
        .normalize('NFKD')
        .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();

    const mapUnicodeDigit = (ch: string): string => {
      const code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10);
      return ch;
    };
    const toAsciiDigits = (v: string) => Array.from(v).map(mapUnicodeDigit).join('');
    const onlyDigits = (v: string) => toAsciiDigits(normalizeUnicode(v)).replace(/\D/g, '');

    const formatCpf = (v: string) => {
      const d = onlyDigits(v).slice(0, 11);
      if (d.length <= 3) return d;
      if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
      if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
    };

    const calcDV = (base: string, start: number) => {
      let soma = 0;
      for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (start - i);
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const allSame = (d: string) => /^(\d)\1{10}$/.test(d);
    const isValid11 = (d: string) => {
      if (d.length !== 11 || allSame(d)) return false;
      const dv1 = calcDV(d.slice(0, 9), 10);
      const dv2 = calcDV(d.slice(0, 10), 11);
      return dv1 === Number(d[9]) && dv2 === Number(d[10]);
    };

    const validarLeniente = (v: string) => {
      const digitsAll = onlyDigits(v);
      if (digitsAll.length === 11) return isValid11(digitsAll);
      if (digitsAll.length > 11) {
        const right11 = digitsAll.slice(-11);
        if (isValid11(right11)) return true;
        for (let i = 0; i <= digitsAll.length - 11; i++) {
          const win = digitsAll.slice(i, i + 11);
          if (isValid11(win)) return true;
        }
        return false;
      }
      return false;
    };

    const onInput = () => {
      const masked = formatCpf(el.value);
      if (el.value !== masked) {
        el.value = masked;
        const evt = new Event('input', { bubbles: true });
        el.dispatchEvent(evt);
      }
    };

    const onBlur = () => {
      const ok = validarLeniente(el.value);
      const hasDigits = onlyDigits(el.value).length > 0;
      el.classList.toggle('is-invalid', !ok && hasDigits);
      el.classList.toggle('is-valid', ok);
      if (ok) {
        const masked = formatCpf(el.value);
        if (el.value !== masked) {
          el.value = masked;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    };

    el.value = formatCpf(el.value);
    el.addEventListener('input', onInput);
    el.addEventListener('blur', onBlur);

    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', onBlur);
    };
  }

  onSubmit(): void {
    if (!this.cpfValido(this.model.cpf)) {
      this.showMsg('danger', 'CPF inválido!', 6000);
      return;
    }
    this.showMsg('success', 'CPF válido! ✅', 2500);
  }

  private cpfValido(cpf: unknown, strict = false): boolean {
    try {
      const normalizeUnicode = (v: string) =>
        (v ?? '')
          .toString()
          .normalize('NFKD')
          .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
          .replace(/\u00A0/g, ' ')
          .trim();

      const mapUnicodeDigit = (ch: string): string => {
        const code = ch.charCodeAt(0);
        if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
        if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
        if (code >= 0xFF10 && code <= 0xFF19) return String(code - 0xFF10);
        return ch;
      };
      const toAsciiDigits = (v: string) => Array.from(v).map(mapUnicodeDigit).join('');
      const rawNorm = normalizeUnicode(String(cpf ?? ''));
      const rawAscii = toAsciiDigits(rawNorm);
      const onlyDigits = rawAscii.replace(/\D/g, '');
      const allSame = (d: string) => /^(\d)\1{10}$/.test(d);
      const calcDV = (base: string, start: number) => {
        let soma = 0;
        for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (start - i);
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
      };
      const isValid11 = (d: string) => {
        if (d.length !== 11 || allSame(d)) return false;
        const dv1 = calcDV(d.slice(0, 9), 10);
        const dv2 = calcDV(d.slice(0, 10), 11);
        return dv1 === Number(d[9]) && dv2 === Number(d[10]);
      };

      if (strict) return isValid11(onlyDigits);
      if (onlyDigits.length === 11) return isValid11(onlyDigits);
      if (onlyDigits.length > 11) {
        const right11 = onlyDigits.slice(-11);
        if (isValid11(right11)) return true;
        for (let i = 0; i <= onlyDigits.length - 11; i++) {
          const win = onlyDigits.slice(i, i + 11);
          if (isValid11(win)) return true;
        }
        return false;
      }
      const pattern = /\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d/g;
      const matches = rawAscii.match(pattern);
      if (matches) {
        for (const m of matches) {
          const dig = m.replace(/\D/g, '');
          if (dig.length === 11 && isValid11(dig)) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // ===== Init =====
  async ngOnInit() {
    this.atualizarParcelasLabels();
    this.atualizarResumo();
    this.recalcularTotaisFromFluxoCaixa();

    this._cpfCleanup = this.inicializarMascaraCPF();

    this.route.queryParamMap.subscribe(async (qp) => {
      this.editMode = qp.get('edit') === 'true';
      this.docPath = qp.get('path');
      this.docId = qp.get('id');

      if (!this.editMode) return;

      try {
        let ref;
        if (this.docPath) {
          ref = doc(this.afs, this.docPath);
        } else if (this.docId) {
          ref = doc(this.afs, 'pre_cadastros', this.docId);
        } else {
          throw new Error('Sem path ou id para carregar o pré-cadastro.');
        }

        const snap = await getDoc(ref);
        if (!snap.exists()) {
          this.showMsg('danger', 'Pré-cadastro não encontrado.', 6000);
          return;
        }

        const data = snap.data() as any;

        const cidade =
          data.cidade ??
          data.enderecoCidade ??
          data.addressCidade ??
          '';
        const ufRaw =
          data.uf ??
          data.enderecoUF ??
          data.addressUF ??
          '';
        const uf = (ufRaw || '').toString().trim().toUpperCase();

        this.model = {
          nomeCompleto: data.nomeCompleto ?? '',
          cpf: data.cpf ?? '',
          endereco: data.endereco ?? data.enderecoCompleto ?? '',
          telefone: data.telefone ?? data.contato ?? '',
          email: data.email ?? '',
          bairro: data.bairro ?? '',
          origem: data.origem ?? '',
          cidade: cidade || '',
          uf: uf || '',
        };

        // 👇 AQUI ENTRA O TRECHO
        this.valorSolicitadoNumber = Number(data?.valorSolicitado || 0);
        this.valorSolicitadoMasked = this.maskOrEmpty(this.valorSolicitadoNumber);
        this.parcelasSelecionadas = Number(data?.parcelas || 0) || null;

        this.fluxoCaixa = data?.fluxoCaixa ?? this.fluxoCaixa;
        this.fluxoCaixaTotais = data?.fluxoCaixaTotais ?? this.fluxoCaixaTotais;

        this.atualizarParcelasLabels();
        this.atualizarResumo();
        this.recalcularTotaisFromFluxoCaixa();

        this.lastPreCadastroId = snap.id;

        setTimeout(() => {
          const el = document.querySelector('input[name="cpf"]') as HTMLInputElement | null;
          if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
        }, 0);
      } catch (e: any) {
        console.error('[PreCadastro] Erro ao carregar doc para edição:', e);
        this.showMsg('danger', e?.message || 'Erro ao carregar o pré-cadastro para edição.', 7000);
      }
    });
  }


  // ================= Lógica Financeira =================
  calcularParcela(pv: number, n: number, i: number): number {
    if (!pv || !n || !i) return 0;
    const fator = i / (1 - Math.pow(1 + i, -n));
    return pv * fator;
  }

  onValorChange(raw: any) {
    this.valorSolicitadoNumber = this.parseMoedaBR(raw);
    this.atualizarParcelasLabels();
    this.atualizarResumo();
  }

  onParcelasChange(_: number) {
    this.atualizarResumo();
  }

  atualizarParcelasLabels() {
    this.parcelasComValor = this.parcelas.map((n) => {
      const v = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
      return { n, valorParcela: v, label: `${n}x de ${this.formatBRL(v)}` };
    });
  }

  atualizarResumo() {
    const n = Number(this.parcelasSelecionadas || 0);
    if (!n || !this.valorSolicitadoNumber) {
      this.resumoParcela = '';
      return;
    }
    const pmt = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
    const total = pmt * n;
    this.resumoParcela = `${n}x de ${this.formatBRL(pmt)} • Total: ${this.formatBRL(total)}`;
  }

  getParcelaEscolhidaNumber(): number {
    const n = Number(this.parcelasSelecionadas || 0);
    if (!n || !this.valorSolicitadoNumber) return 0;
    return this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
  }

  private getOutrasRendasNumber(): number {
    return 0;
  }
  computeParcelaSugerida() {
    const lucro = this.fluxoCaixaTotais?.lucro || 0;
    const outras = this.getOutrasRendasNumber();
    const base = lucro > 0 ? lucro + outras : outras;
    if (base <= 0) return { valor: 0, fator: 0.3, base: 0 };
    const valor = base * 0.3;
    return { valor, fator: 0.3, base };
  }
  getComparacaoParcelaTexto(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return '';
    const diff = escolhida - sugerida;
    const limite10 = sugerida * 1.1;
    if (diff > 0) {
      if (escolhida <= limite10) return 'Parcela dentro do limite admitido';
      return `Acima da sugerida em ${this.formatBRL(diff)}.`;
    } else if (diff < 0) {
      return `Abaixo da sugerida em ${this.formatBRL(Math.abs(diff))}.`;
    }
    return 'Igual à sugerida.';
  }
  getComparacaoParcelaClasse(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return 'text-muted';
    if (escolhida <= sugerida) return 'text-dark';
    if (escolhida <= sugerida * 1.1) return 'text-dark';
    return 'text-dark';
  }
  getParcelaEscolhidaClasse(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return 'bg-secondary-subtle text-dark border';
    if (escolhida <= sugerida) return 'bg-success-subtle text-dark border';
    if (escolhida <= sugerida * 1.1) return 'bg-warning-subtle text-dark border';
    return 'bg-danger-subtle text-dark border';
  }

  // ===== Totais do modal =====
  totalReceita(): number {
    return this.fluxoForm.faturamentoMensal || 0;
  }
  totalCustos(): number {
    const f = this.fluxoForm.fixos;
    const v = this.fluxoForm.variaveis;
    const somaFixos =
      (f.aluguel || 0) + (f.salarios || 0) + (f.energiaEletrica || 0) + (f.agua || 0) + (f.telefoneInternet || 0);
    const somaVar =
      (v.materiaPrima || 0) + (v.insumos || 0) + (v.frete || 0) + (v.transporte || 0) +
      (v.outros || []).reduce((acc: number, o) => acc + (o.valor || 0), 0);
    return somaFixos + somaVar;
  }
  totalLucro(): number {
    return this.totalReceita() - this.totalCustos();
  }

  // ====== Abrir/fechar modal (instância única) ======
  openFluxoModal() {
    const f: FluxoCaixa =
      this.fluxoCaixa || {
        faturamentoMensal: 0,
        fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
        variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
      };

    // numéricos
    this.faturamento = f.faturamentoMensal || 0;
    this.fluxoForm.faturamentoMensal = this.faturamento;

    this.fluxoForm.fixos.aluguel = f.fixos.aluguel || 0;
    this.fluxoForm.fixos.salarios = f.fixos.salarios || 0;
    this.fluxoForm.fixos.energiaEletrica = f.fixos.energiaEletrica || 0;
    this.fluxoForm.fixos.agua = f.fixos.agua || 0;
    this.fluxoForm.fixos.telefoneInternet = f.fixos.telefoneInternet || 0;

    this.fluxoForm.variaveis.materiaPrima = f.variaveis.materiaPrima || 0;
    this.fluxoForm.variaveis.insumos = f.variaveis.insumos || 0;
    this.fluxoForm.variaveis.frete = f.variaveis.frete || 0;
    this.fluxoForm.variaveis.transporte = f.variaveis.transporte || 0;

    // masked (para não mostrar zero)
    this.faturamentoInput = this.maskOrEmpty(this.faturamento);
    this.fluxoForm.fixos.aluguelMasked = this.maskOrEmpty(this.fluxoForm.fixos.aluguel);
    this.fluxoForm.fixos.salariosMasked = this.maskOrEmpty(this.fluxoForm.fixos.salarios);
    this.fluxoForm.fixos.energiaEletricaMasked = this.maskOrEmpty(this.fluxoForm.fixos.energiaEletrica);
    this.fluxoForm.fixos.aguaMasked = this.maskOrEmpty(this.fluxoForm.fixos.agua);
    this.fluxoForm.fixos.telefoneInternetMasked = this.maskOrEmpty(this.fluxoForm.fixos.telefoneInternet);

    this.fluxoForm.variaveis.materiaPrimaMasked = this.maskOrEmpty(this.fluxoForm.variaveis.materiaPrima);
    this.fluxoForm.variaveis.insumosMasked = this.maskOrEmpty(this.fluxoForm.variaveis.insumos);
    this.fluxoForm.variaveis.freteMasked = this.maskOrEmpty(this.fluxoForm.variaveis.frete);
    this.fluxoForm.variaveis.transporteMasked = this.maskOrEmpty(this.fluxoForm.variaveis.transporte);

    this.fluxoForm.variaveis.outros = (f.variaveis.outros || []).map((o) => ({
      nome: o.nome,
      valor: o.valor || 0,
      valorMasked: this.maskOrEmpty(o.valor || 0),
    }));

    if (!this.fluxoModalRef) {
      const el = this.fluxoModalEl?.nativeElement;
      if (el) this.fluxoModalRef = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });
    }
    this.fluxoModalRef?.show();
  }


  closeFluxoModal() {
    this.fluxoModalRef?.hide();
  }

  /** Valor Solicitado (com máscara): atualiza número e rótulos */
  onValorMaskedChange(masked: string | null) {
    this.valorSolicitadoMasked = masked ?? '';
    this.valorSolicitadoNumber = this.parseBRN(this.valorSolicitadoMasked || '');
    this.atualizarParcelasLabels();
    this.atualizarResumo();
  }

  /** Exibe string “R$ …” ou '' (para não mostrar 0) */
  private maskOrEmpty(n: number): string {
    return n && isFinite(n) && n > 0 ? this.formatBRN(n) : '';
  }

  /** Conveniência */
  get hasValorSolicitado(): boolean {
    return !!(this.valorSolicitadoNumber && this.valorSolicitadoNumber > 0);
  }


  /** Atualiza faturamento a partir da máscara (R$ …) */
  onFaturamentoMaskedChange(masked: string | null) {
    this.faturamentoInput = masked ?? '';
    const n = this.parseBRN(masked ?? '');
    this.faturamento = n;
    this.fluxoForm.faturamentoMensal = n;
  }


  syncNumber(path: string, masked: string) {
    const n = this.parseBRN(masked);
    const set = (obj: any, p: string[], value: number): void => {
      if (p.length === 1) { obj[p[0]] = value; return; }
      set(obj[p[0]], p.slice(1), value);
    };
    set(this.fluxoForm, path.split('.'), n);
  }
  syncOutroValor(i: number, masked: string) {
    const val = this.parseBRN(masked);
    this.fluxoForm.variaveis.outros[i].valor = val;
  }
  addOutro() {
    this.fluxoForm.variaveis.outros.push({ nome: '', valorMasked: '', valor: 0 });
  }
  removeOutro(i: number) {
    this.fluxoForm.variaveis.outros.splice(i, 1);
  }

  salvarFluxo() {
    this.fluxoCaixa = {
      faturamentoMensal: this.fluxoForm.faturamentoMensal || 0,
      fixos: {
        aluguel: this.fluxoForm.fixos.aluguel || 0,
        salarios: this.fluxoForm.fixos.salarios || 0,
        energiaEletrica: this.fluxoForm.fixos.energiaEletrica || 0,
        agua: this.fluxoForm.fixos.agua || 0,
        telefoneInternet: this.fluxoForm.fixos.telefoneInternet || 0,
      },
      variaveis: {
        materiaPrima: this.fluxoForm.variaveis.materiaPrima || 0,
        insumos: this.fluxoForm.variaveis.insumos || 0,
        frete: this.fluxoForm.variaveis.frete || 0,
        transporte: this.fluxoForm.variaveis.transporte || 0,
        outros: (this.fluxoForm.variaveis.outros || []).map((o) => ({ nome: o.nome || 'Outro', valor: o.valor || 0 })),
      },
    };

    this.recalcularTotaisFromFluxoCaixa();
    this.atualizarParcelasLabels();
    this.atualizarResumo();

    this.closeFluxoModal();
  }

  private somaFixos(f: FluxoFixos) {
    return (
      (f.aluguel || 0) +
      (f.salarios || 0) +
      (f.energiaEletrica || 0) +
      (f.agua || 0) +
      (f.telefoneInternet || 0)
    );
  }
  private somaVariaveis(v: FluxoVariaveis) {
    const b = (v.materiaPrima || 0) + (v.insumos || 0) + (v.frete || 0) + (v.transporte || 0);
    const outros = (v.outros || []).reduce((acc, o) => acc + (o.valor || 0), 0);
    return b + outros;
  }
  private recalcFrom(fluxo: FluxoCaixa | null): FluxoTotais {
    if (!fluxo) return { receita: 0, custos: 0, lucro: 0 };
    const receita = +(fluxo.faturamentoMensal || 0);
    const custos = this.somaFixos(fluxo.fixos) + this.somaVariaveis(fluxo.variaveis);
    const lucro = receita - custos;
    return { receita, custos, lucro };
  }
  private recalcularTotaisFromFluxoCaixa() {
    this.fluxoCaixaTotais = this.recalcFrom(this.fluxoCaixa);
  }

  private abrirFeedbackModal() {
    if (!this.feedbackModalRef) return;
    this.feedbackModal = new bootstrap.Modal(this.feedbackModalRef.nativeElement, { backdrop: 'static' });
    this.feedbackModal.show();
  }
  fecharFeedbackModal() {
    this.feedbackModal?.hide();
  }
  setStar(field: keyof Pick<FeedbackCliente, 'notaAtendimento' | 'cordialidade' | 'clareza'>, v: Star) {
    this.feedback[field] = v;
  }

  // ================== SALVAR ==================
  async salvar(form: NgForm) {
    if (this.loading()) return;

    const payloadBase = {
      nomeCompleto: this.limpar(this.model.nomeCompleto),
      cpf: this.limpar(this.model.cpf),
      endereco: this.limpar(this.model.endereco),
      telefone: this.limpar(this.model.telefone),
      email: this.limpar(this.model.email),
      origem: this.limpar(this.model.origem),
      bairro: this.limpar(this.model.bairro),
      cidade: this.limpar(this.model.cidade || ''),
      uf: (this.model.uf || '').toString().trim().toUpperCase(),
    };

    if (payloadBase.cpf && !this.cpfValido(payloadBase.cpf, true)) {
      this.showMsg('danger', 'CPF inválido.', 6000);
      return;
    }

    if (!form.valid) {
      const invalids = Object.keys(form.controls).filter(k => form.controls[k]?.invalid);
      const msgCampos = invalids.length ? `Campos inválidos/obrigatórios: ${invalids.join(', ')}` : 'Revise os campos obrigatórios.';
      this.showMsg('danger', msgCampos, 7000);
      return;
    }

    const parcelaSelecionada = Number(this.parcelasSelecionadas || 0) || 0;
    const valorParcela = this.getParcelaEscolhidaNumber();
    const valorParcelaFormatado = this.formatBRN(valorParcela);
    const valorSolicitadoFormatado = this.formatBRN(this.valorSolicitadoNumber);

    const payloadFinanceiro = {
      valorSolicitado: this.valorSolicitadoNumber,
      valorSolicitadoFormatado,
      parcelas: parcelaSelecionada || null,
      valorParcela,
      valorParcelaFormatado,
      fluxoCaixa: this.fluxoCaixa,
      fluxoCaixaTotais: this.fluxoCaixaTotais,
    };

    const payload = { ...payloadBase, ...payloadFinanceiro };

    this.loading.set(true);
    this.msg.set(null);
    this.msgType.set(null);

    try {
      if (this.editMode) {
        let ref;
        if (this.docPath) {
          ref = doc(this.afs, this.docPath);
        } else if (this.docId) {
          ref = doc(this.afs, 'pre_cadastros', this.docId);
        } else {
          throw new Error('Sem referência para atualizar o pré-cadastro.');
        }

        await updateDoc(ref, {
          ...payload,
          atualizadoEm: new Date(),
        });

        this.showMsg('success', 'Pré-cadastro atualizado com sucesso!');
      } else {
        const id = await this.service.criar(payload);
        this.lastPreCadastroId = id;

        this.showMsg('success', 'Pré-cadastro salvo com sucesso!');

        form.resetForm();

        this.valorSolicitadoMasked = '';
        this.valorSolicitadoNumber = 0;
        this.parcelasSelecionadas = null;
        this.parcelasComValor = [];
        this.resumoParcela = '';

        this.model.cidade = '';
        this.model.uf = '';

        this.fluxoCaixa = {
          faturamentoMensal: 0,
          fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
          variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
        };
        this.recalcularTotaisFromFluxoCaixa();
        this.atualizarParcelasLabels();

        setTimeout(() => this.abrirFeedbackModal(), 0);
      }
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar/atualizar:', e);
      this.showMsg('danger', e?.message || 'Erro ao salvar o pré-cadastro.', 7000);
    } finally {
      this.loading.set(false);
    }
  }

  private debugOut(msg: string, obj?: any) {
    try {
      console.log(msg, obj ?? '');
    } catch (_) {
      const id = '__cpf_debug_toast__';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;bottom:8px;right:8px;max-width:60vw;background:#111;color:#0f0;padding:8px 12px;font:12px/1.4 monospace;z-index:99999;border-radius:6px;opacity:.9';
        document.body.appendChild(el);
      }
      el.textContent = `${msg} ${obj ? JSON.stringify(obj) : ''}`;
      setTimeout(() => { if (el && el.parentElement) el.parentElement.removeChild(el); }, 4000);
    }
  }

  // ================== FEEDBACK: salvar ==================
  async salvarFeedbackCliente() {
    if (!this.lastPreCadastroId) {
      this.showMsg('danger', 'Não foi possível identificar o pré-cadastro para registrar o feedback.', 7000);
      return;
    }

    try {
      await this.service.registrarFeedbackCliente(this.lastPreCadastroId, this.feedback);
      this.showMsg('success', 'Avaliação do cliente registrada. Obrigado!');
      this.fecharFeedbackModal();
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar feedback do cliente:', e);
      this.showMsg('danger', e?.message || 'Erro ao salvar a avaliação do cliente.', 7000);
    }
  }
}
