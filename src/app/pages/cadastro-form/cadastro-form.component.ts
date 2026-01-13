import {
  Component,
  OnInit,
  AfterViewInit,
  ElementRef,
  ViewChild,
  NgZone,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Cliente, FluxoCaixa, StatusCadastro, StatusEvent } from '../../models/cliente.model';
import { municipiosNorte } from '../../../shared/municipios-norte';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { ActivatedRoute } from '@angular/router';

// Auth
import { Auth } from '@angular/fire/auth';

// Firestore
import { db } from '../../firebase.config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

// Storage (usa a MESMA instância exportada em firebase.config.ts)
import { FirebaseStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage as fbStorage } from '../../firebase.config';

import emailjs, { EmailJSResponseStatus } from 'emailjs-com';

declare const bootstrap: any;

type MaskedNumber = string | null;

@Component({
  selector: 'app-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgxMaskDirective],
  templateUrl: './cadastro-form.component.html',
  styleUrls: ['./cadastro-form.component.css'],
  providers: [provideNgxMask()],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CadastroFormComponent implements OnInit, AfterViewInit {
  // --------- ESTADO PRINCIPAL ---------
  cliente: Cliente = this.novoCliente();

  // ---- Datas ----
  dias: number[] = [];
  meses: string[] = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  anos: number[] = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i);

  diaSelecionado: number | null = null;
  mesSelecionado: number | null = null; // 1..12
  anoSelecionado: number | null = null;

  // ---- Controle "Outro" ----
  selecionouOutroTipoNegocio = false;
  selecionouOutroOndeVende = false;
  selecionouOutroGenero = false;

  private opcoesTipoNegocioPadrao = new Set<string>([
    'Mercearia', 'Vendedor ambulante', 'Comércio de roupas', 'Cosméticos e perfumes', 'Bijuterias e acessórios',
    'Loja de variedades', 'Alimentos e bebidas', 'Materiais de construção', 'Papelaria e utilidades',
    'Lanchonete', 'Restaurante caseiro', 'Venda de salgados e doces', 'Churrasquinho de rua', 'Padaria artesanal',
    'Açaí e sorvetes', 'Marmitas', 'Salão de beleza', 'Barbearia', 'Manicure e pedicure',
    'Estética e design de sobrancelhas', 'Costura e conserto de roupas', 'Bordado e customização',
    'Serviços de limpeza', 'Lavanderia', 'Reparos domésticos', 'Pintura', 'Serralheria',
    'Oficina de bicicletas', 'Oficina de motos', 'Assistência de celulares', 'Serviços de informática',
    'Mototaxi', 'Fretes e entregas', 'Hortifruti', 'Criação de aves', 'Criação de peixes',
    'Criação de suínos', 'Plantas ornamentais', 'Artesanato em madeira', 'Artesanato em cerâmica',
    'Artesanato com fibras', 'Confecção', 'Fotografia e filmagem', 'Produção cultural'
  ]);
  private opcoesOndeVendePadrao = new Set<string>(['Na minha casa', 'Online', 'Na rua/feira']);

  cpfValido: boolean | null = null;

  estadosNorte = [
    { sigla: 'AC', nome: 'Acre' },
    { sigla: 'AP', nome: 'Amapá' },
    { sigla: 'AM', nome: 'Amazonas' },
    { sigla: 'PA', nome: 'Pará' },
    { sigla: 'RO', nome: 'Rondônia' },
    { sigla: 'RR', nome: 'Roraima' },
    { sigla: 'TO', nome: 'Tocantins' }
  ];

  municipios: string[] = [];

  // ---- Empréstimo / Parcelas ----
  parcelas: number[] = Array.from({ length: 12 }, (_, i) => i + 1);
  jurosMes = 0.0274; // 2,74% a.m.
  valorSolicitadoNumber = 0;
  parcelasComValor: { n: number; label: string; valorParcela: number }[] = [];
  resumoParcela = '';

  // ---- Data de preenchimento ----
  diaPre: number | '' = '';
  mesPre: number | '' = '';
  anoPre: number | '' = '';

  // ---- Modais ----
  private fluxoModalRef: any | null = null;
  private anexosModalRef: any | null = null;

  // ---- Form do Fluxo de Caixa ----
  fluxoForm = {
    faturamentoMensalMasked: '' as MaskedNumber,
    faturamentoMensalView: '' as string,
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

  // ================== ANEXOS & ASSINATURA ==================
  private readonly MAX_QTD_POR_CATEGORIA = 5;
  private readonly MAX_MB_POR_ARQUIVO = 10;
  private readonly THUMB_PX = 200;
  private readonly COMPRESS_MAX_DIM = 1600;
  private readonly COMPRESS_QUALITY = 0.8;

  categoriasDocs = [
    { key: 'docPessoa', label: 'Foto do documento', multiple: true },
    { key: 'fotoPessoa', label: 'Foto do cliente', multiple: true },
    { key: 'selfieDocumento', label: 'Cliente com documento', multiple: true },
    { key: 'fotoEmpreendimento', label: 'Foto do empreendimento', multiple: true },
    { key: 'fotoProdutos', label: 'Foto dos produtos', multiple: true },
    { key: 'fotoEquipamentos', label: 'Foto dos equipamentos', multiple: true },
    { key: 'orcamento', label: 'Orçamento (foto)', multiple: true },
    { key: 'planoNegocio', label: 'Plano de negócio (foto)', multiple: true },
  ];
  arquivosMap: Record<string, File[]> = {};
  previewMap: Record<string, string[]> = {};

  // Assinatura
  @ViewChild('signatureCanvas') signatureCanvas!: ElementRef<HTMLCanvasElement>;
  private sigCtx!: CanvasRenderingContext2D;
  private desenhando = false;
  private ultimoPonto: { x: number, y: number } | null = null;
  signatureDataUrl: string | null = null;
  signaturePreview: string | null = null;

  uploadStatus = { ok: false, msg: '' };
  private storage: FirebaseStorage = fbStorage;

  // Auth
  constructor(private zone: NgZone, private route: ActivatedRoute, private auth: Auth) { }

  private onlyDigits(v?: string): string {
    return (v ?? '').replace(/\D/g, '');
  }

  ngOnInit(): void {
    // Pré-preenchimento por querystring
    this.route.queryParams.subscribe(params => {
      const nome = params['nome'] ?? '';
      const cpf = this.onlyDigits(params['cpf'] ?? '');
      const contato = this.onlyDigits(params['contato'] ?? '');
      const email = params['email'] ?? '';
      const endereco = params['endereco'] ?? '';
      const preId = params['preCadastroId'] ?? '';

      if (nome) this.cliente.nomeCompleto = nome;
      if (cpf) this.cliente.cpf = cpf;
      if (contato) this.cliente.contato = contato;
      if (email) this.cliente.email = email;
      if (endereco) this.cliente.endereco = endereco;
      (this.cliente as any).preCadastroId = preId;

      if (cpf) this.cpfValido = this.validarCPF(cpf);
    });

    const nInit = this.parseBRN(String(this.cliente?.faturamentoMensal ?? ''));
    this.faturamento = isNaN(nInit) ? 0 : nInit;
    this.faturamentoInput = this.faturamento ? String(Math.trunc(this.faturamento)) : '';

    this.syncNacionalidadeBaseFromCliente();

    const hoje = new Date();
    this.diaPre = hoje.getDate();
    this.mesPre = hoje.getMonth() + 1;
    this.anoPre = hoje.getFullYear();

    this.atualizarDataPreenchimento();
    this.atualizarParcelasLabels();
    this.atualizarDias();

    const clienteEditando = localStorage.getItem('clienteEditando');
    if (clienteEditando) {
      try {
        const edit = JSON.parse(clienteEditando);
        this.cliente = edit;
        if (edit?._thumbUrl) this.previewMap['fotoPessoa'] = [edit._thumbUrl];
        if (edit?._assinaturaUrl) {
          this.signatureDataUrl = edit._assinaturaUrl;
          this.signaturePreview = edit._assinaturaUrl;
        }
        this.atualizarMunicipios();
        if (this.cliente.dataNascimento) {
          const [ano, mes, dia] = this.cliente.dataNascimento.split('-').map((v: string) => parseInt(v, 10));
          if (ano && mes && dia) {
            this.anoSelecionado = ano;
            this.mesSelecionado = mes;
            this.atualizarDias();
            this.diaSelecionado = Math.min(dia, this.dias[this.dias.length - 1]);
          }
        }
        this.atualizarDataNascimento();
        if (this.cliente.fluxoCaixa) this.recalcular();
        this.valorSolicitadoNumber = this.parseMoedaBR(this.cliente.valorSolicitado || 0);
        this.atualizarParcelasLabels();
        this.atualizarResumo();
      } catch { /* ignore */ }
      finally {
        localStorage.removeItem('clienteEditando');
      }
    }

    this.selecionouOutroTipoNegocio =
      !!(this.cliente.tipoNegocio && !this.opcoesTipoNegocioPadrao.has(this.cliente.tipoNegocio));
    this.selecionouOutroOndeVende =
      !!(this.cliente.ondeVende && !this.opcoesOndeVendePadrao.has(this.cliente.ondeVende));
  }

  ngAfterViewInit(): void {
    // Canvas pode não existir dependendo do template/rota — proteja
    if (!this.signatureCanvas?.nativeElement) return;
    this.initSignatureCanvas();
  }

  // ============ ASSINATURA (PRECISA E ESTÁVEL) ============
  private pointerDownHandler = (e: PointerEvent) => this.iniciarDesenho(e);
  private pointerMoveHandler = (e: PointerEvent) => this.continuarDesenho(e);
  private pointerUpHandler = (_: PointerEvent) => this.pararDesenho();

  private initSignatureCanvas() {
    const canvas = this.signatureCanvas?.nativeElement;
    if (!canvas) return;

    // Contexto
    this.sigCtx = canvas.getContext('2d')!;
    this.sigCtx.lineWidth = 2;
    this.sigCtx.lineCap = 'round';
    this.sigCtx.strokeStyle = '#111';

    // Ajuste de DPI com base no tamanho CSS atual
    this.ajustarDPI();

    // Desabilita gesto de rolagem enquanto desenha
    canvas.style.touchAction = 'none';

    // Usa Pointer Events (cobre mouse/touch/caneta)
    this.zone.runOutsideAngular(() => {
      canvas.addEventListener('pointerdown', this.pointerDownHandler);
      canvas.addEventListener('pointermove', this.pointerMoveHandler);
      window.addEventListener('pointerup', this.pointerUpHandler);
      window.addEventListener('pointercancel', this.pointerUpHandler);
      window.addEventListener('resize', () => this.ajustarDPI());
    });

    // Se houver assinatura salva, opcionalmente renderiza no canvas
    if (this.signatureDataUrl) {
      const img = new Image();
      img.onload = () => {
        this.sigCtx.clearRect(0, 0, canvas.width, canvas.height);
        const r = this.getCanvasVisibleRect();
        this.sigCtx.drawImage(img, 0, 0, r.w, r.h);
      };
      img.src = this.signatureDataUrl;
    }
  }

  private getCanvasVisibleRect() {
    const canvas = this.signatureCanvas.nativeElement;
    // largura/altura CSS (visível)
    const cssW = canvas.clientWidth || canvas.offsetWidth || 300;
    const cssH = canvas.clientHeight || canvas.offsetHeight || 150;
    // dpi real
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    return { cssW, cssH, w, h, dpr };
  }

  private ajustarDPI() {
    if (!this.signatureCanvas) return;
    const canvas = this.signatureCanvas.nativeElement;
    const { cssW, cssH, w, h, dpr } = this.getCanvasVisibleRect();

    // Define resolução física baseada no tamanho CSS
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    // Reescala o contexto
    this.sigCtx.setTransform(1, 0, 0, 1, 0, 0); // reset
    this.sigCtx.scale(dpr, dpr);
    this.sigCtx.lineWidth = 2;
  }

  private getPos(e: PointerEvent) {
    const canvas = this.signatureCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    // Mapeia coords do ponteiro (pixels CSS) para coords do canvas (sem DPR)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * (1 / Math.max(1, Math.min(window.devicePixelRatio || 1, 2)));
    const y = (e.clientY - rect.top) * (1 / Math.max(1, Math.min(window.devicePixelRatio || 1, 2)));
    return { x: x * scaleX / (canvas.width / rect.width), y: y * scaleY / (canvas.height / rect.height) };
  }

  private iniciarDesenho(e: PointerEvent) {
    if (!this.sigCtx) return;
    const canvas = this.signatureCanvas.nativeElement;
    this.desenhando = true;
    this.ultimoPonto = this.getPos(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private continuarDesenho(e: PointerEvent) {
    if (!this.desenhando || !this.ultimoPonto || !this.sigCtx) return;
    const atual = this.getPos(e);
    this.sigCtx.beginPath();
    this.sigCtx.moveTo(this.ultimoPonto.x, this.ultimoPonto.y);
    this.sigCtx.lineTo(atual.x, atual.y);
    this.sigCtx.stroke();
    this.ultimoPonto = atual;
    e.preventDefault();
  }

  private pararDesenho() {
    this.desenhando = false;
    this.ultimoPonto = null;
  }

  limparAssinatura() {
    if (!this.signatureCanvas || !this.sigCtx) return;
    const canvas = this.signatureCanvas.nativeElement;
    this.sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.signatureDataUrl = null;
    this.signaturePreview = null;
  }

  salvarAssinatura() {
    if (!this.signatureCanvas) return;
    const canvas = this.signatureCanvas.nativeElement;
    // Exporta no tamanho real (já ajustado a DPR)
    const dataUrl = canvas.toDataURL('image/png');
    this.signatureDataUrl = dataUrl;
    this.signaturePreview = dataUrl;
  }

  private dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  // ================== MINIATURAS & COMPRESSÃO ==================
  private fileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  private async generateThumbnail(file: File, maxSize = this.THUMB_PX): Promise<string> {
    const img = await this.fileToImage(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(img.src);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  private async compressImage(file: File, maxDim = this.COMPRESS_MAX_DIM, quality = this.COMPRESS_QUALITY): Promise<Blob> {
    const img = await this.fileToImage(file);
    const { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    URL.revokeObjectURL(img.src);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob(b => resolve(b!), 'image/jpeg', quality)
    );
  }

  async onFilesChange(key: string, evt: Event) {
    const input = evt.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter(f => f.type.startsWith('image/'));
    const selecionados = files.slice(0, this.MAX_QTD_POR_CATEGORIA);

    const muitoGrandes = selecionados.filter(f => f.size > this.MAX_MB_POR_ARQUIVO * 1024 * 1024);
    if (muitoGrandes.length) {
      alert(`⚠️ Arquivo(s) acima de ${this.MAX_MB_POR_ARQUIVO}MB foram ignorados.`);
    }
    const validos = selecionados.filter(f => f.size <= this.MAX_MB_POR_ARQUIVO * 1024 * 1024);

    this.previewMap[key] = [];
    if (validos[0]) {
      const thumb = await this.generateThumbnail(validos[0]);
      this.previewMap[key] = [thumb];
    }

    this.arquivosMap[key] = validos;
  }

  // ---------- Datas ----------
  onChangeMesOuAno() {
    this.atualizarDias();
    if (this.diaSelecionado && !this.dias.includes(this.diaSelecionado)) {
      this.diaSelecionado = this.dias[this.dias.length - 1] ?? null;
    }
    this.atualizarDataNascimento();
  }

  atualizarDataNascimento() {
    if (this.diaSelecionado && this.mesSelecionado && this.anoSelecionado) {
      const dia = String(this.diaSelecionado).padStart(2, '0');
      const mes = String(this.mesSelecionado).padStart(2, '0');
      const ano = this.anoSelecionado;
      const composta = `${ano}-${mes}-${dia}`;
      if (this.isDataValida(ano, this.mesSelecionado, this.diaSelecionado)) {
        this.cliente.dataNascimento = composta;
      } else {
        this.cliente.dataNascimento = '';
      }
    } else {
      this.cliente.dataNascimento = '';
    }
  }

  private atualizarDias() {
    const ano = this.anoSelecionado ?? new Date().getFullYear();
    const mes = this.mesSelecionado ?? 1;
    const max = this.diasNoMes(ano, mes);
    this.dias = Array.from({ length: max }, (_, i) => i + 1);
  }

  private diasNoMes(ano: number, mes1a12: number): number {
    return new Date(ano, mes1a12, 0).getDate();
  }

  private isDataValida(ano: number, mes1a12: number, dia: number): boolean {
    if (!ano || !mes1a12 || !dia) return false;
    if (mes1a12 < 1 || mes1a12 > 12) return false;
    if (dia < 1 || dia > this.diasNoMes(ano, mes1a12)) return false;
    return true;
  }

  // ---------- "Outro" lógicas ----------
  aoTrocarGenero(event: string) {
    if (event === 'Outro') {
      this.selecionouOutroGenero = true;
      this.cliente.genero = '';
    } else {
      this.selecionouOutroGenero = false;
      this.cliente.genero = event;
    }
  }

  aoTrocarTipoNegocio(valor: string) {
    if (valor === 'Outro') {
      this.selecionouOutroTipoNegocio = true;
      this.cliente.tipoNegocio = '';
    } else {
      this.selecionouOutroTipoNegocio = false;
      this.cliente.tipoNegocio = valor;
    }
  }

  aoTrocarOndeVende(valor: string) {
    if (valor === 'Outro') {
      this.selecionouOutroOndeVende = true;
      this.cliente.ondeVende = '';
    } else {
      this.selecionouOutroOndeVende = false;
      this.cliente.ondeVende = valor;
    }
  }

  atualizarMunicipios() {
    const estado = this.cliente.estado ?? '';
    this.municipios = estado ? (municipiosNorte as any)[estado] || [] : [];
    if (!this.municipios.includes(this.cliente.cidade ?? '')) {
      this.cliente.cidade = '';
    }
  }

  // ---------- Validações / Utilitários ----------
  private isEmailValido(v?: string): boolean {
    return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  private isDDDValido(ddd: string): boolean {
    const n = Number(ddd);
    return [
      11, 12, 13, 14, 15, 16, 17, 18, 19,
      21, 22, 24, 27, 28,
      31, 32, 33, 34, 35, 37, 38,
      41, 42, 43, 44, 45, 46, 47, 48, 49,
      51, 53, 54, 55,
      61, 62, 63, 64, 65, 66, 67, 68, 69,
      71, 73, 74, 75, 77, 79,
      81, 82, 83, 84, 85, 86, 87, 88, 89,
      91, 92, 93, 94, 95, 96, 97, 98, 99
    ].includes(n);
  }

  private toE164BR(raw: any): string | null {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 13) digits = digits.slice(2);
    if (digits.length !== 11) return null;
    const ddd = digits.slice(0, 2);
    const assinante = digits.slice(2);
    if (!this.isDDDValido(ddd)) return null;
    if (!assinante.startsWith('9')) return null;
    return `55${ddd}${assinante}`;
  }

  private abrirWhatsAppE164(e164: string, nome?: string) {
    const msg = encodeURIComponent(
      `Olá${nome ? ' ' + nome : ''}, bem-vindo(a) à CRENORTE! Seu cadastro foi concluído com sucesso.`
    );
    const url = `https://wa.me/${e164}?text=${msg}`;
    window.open(url, '_blank');
  }

  private async enviarEmailBemVindo(): Promise<void> {
    if (!this.isEmailValido(this.cliente?.email)) return;

    const templateParams = {
      to_email: this.cliente.email,
      to_name: this.cliente.nomeCompleto || 'Cliente',
      from_name: 'CRENORTE',
      reply_to: 'contato@crenorte.com.br',
      subject: 'Bem-vindo(a) à CRENORTE',
      message: `Olá ${this.cliente.nomeCompleto || ''}, seu cadastro foi concluído com sucesso.`
    };

    try {
      const res = await emailjs.send(
        'service_nsgoz87',
        'template_7sabbwk',
        templateParams,
        'bWkGEOvHh11MNlZi9'
      );
      console.log('E-mail enviado!', res.status, res.text);
    } catch (err) {
      const e = err as EmailJSResponseStatus;
      console.error('Erro ao enviar e-mail:', e?.status, e?.text);
    }
  }

  converterMoedaParaNumero(valor: any): number {
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.'));
  }

  validarCPF(cpf: string): boolean {
    if (!cpf) return false;
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let soma = 0;
    let resto: number;

    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;

    return true;
  }

  onBlurCPF() {
    const cpfLimpo = (this.cliente.cpf ?? '').replace(/\D/g, '');
    this.cpfValido = this.validarCPF(cpfLimpo);
  }

  limparFormularioCadastro() {
    this.cliente = this.novoCliente();
    this.municipios = [];
    this.cpfValido = null;

    this.anoSelecionado = null;
    this.mesSelecionado = null;
    this.diaSelecionado = null;
    this.atualizarDias();

    this.selecionouOutroTipoNegocio = false;
    this.selecionouOutroOndeVende = false;

    this.arquivosMap = {};
    this.previewMap = {};
    this.limparAssinatura();
  }

  private novoCliente(): Cliente {
    return {
      nomeCompleto: '',
      cpf: '',
      rg: '',
      genero: '',
      estadoCivil: '',
      escolaridade: '',
      corRaca: '',
      nacionalidade: '',
      religiao: '',
      paisOrigem: '',
      dataNascimento: '',
      contato: '',
      email: '',
      endereco: '',
      tipoResidencia: '',
      cep: '',
      bairro: '',
      cidade: '',
      estado: '',
      jaEmpreende: false,
      tipoNegocio: '',
      ondeVende: '',
      faturamentoMensal: '',
      tempoEmpreendimento: '',
      ocupacaoAtual: '',
      outraRenda: false,
      rendaMensal: '',
      valorSolicitado: '',
      parcelas: null,
      usoValor: '',
      clienteCrenorte: false,
      dataPreenchimento: '',
      autorizacaoUsoDados: false,
      valorParcela: '',
      emprestimoAtivo: false,
      instituicaoEmprestimo: '',
      fluxoCaixa: null,
      fluxoCaixaTotais: { receita: 0, custos: 0, lucro: 0 },
    };
  }

  // ---------- Empréstimo ----------
  onValorChange(raw: any) {
    this.valorSolicitadoNumber = this.parseMoedaBR(raw);
    this.atualizarParcelasLabels();
    this.atualizarResumo();
  }

  onParcelasChange(_n: number) {
    this.atualizarResumo();
  }

  atualizarParcelasLabels() {
    this.parcelasComValor = this.parcelas.map(n => {
      const v = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
      return { n, valorParcela: v, label: `${n}x de ${this.formatBRL(v)}` };
    });
  }

  atualizarResumo() {
    const n = Number(this.cliente?.parcelas || 0);
    if (!n || !this.valorSolicitadoNumber) {
      this.resumoParcela = '';
      return;
    }
    const pmt = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
    const total = pmt * n;
    this.resumoParcela = `${n}x de ${this.formatBRL(pmt)} • Total: ${this.formatBRL(total)}`;
  }

  calcularParcela(pv: number, n: number, i: number): number {
    if (!pv || !n || !i) return 0;
    const fator = i / (1 - Math.pow(1 + i, -n));
    return pv * fator;
  }

  parseMoedaBR(v: any): number {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const s = String(v).replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  formatBRL(v: number): string {
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  atualizarDataPreenchimento() {
    const d = Number(this.diaPre);
    const m = Number(this.mesPre);
    const a = Number(this.anoPre);

    if (!d || !m || !a) {
      this.cliente.dataPreenchimento = '';
      return;
    }

    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    this.cliente.dataPreenchimento = `${dd}/${mm}/${a}`;
  }

  // ================== UPLOAD (com compressão) ==================
  private async uploadArquivosGrupo(clienteId: string, key: string, files: File[]): Promise<string[]> {
    const urls: string[] = [];
    for (const f of files) {
      const nameSafe = (f.name || 'img').replace(/[^\w.\-]/g, '_');
      const path = `clientes/${clienteId}/${key}/${Date.now()}-${nameSafe}`;

      const isImage = f.type.startsWith('image/');
      const blob = isImage ? await this.compressImage(f, this.COMPRESS_MAX_DIM, this.COMPRESS_QUALITY) : f;

      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, blob, { contentType: isImage ? 'image/jpeg' : f.type || 'application/octet-stream' });
      const url = await getDownloadURL(storageRef);
      urls.push(url);
    }
    return urls;
  }

  private async uploadTodosArquivos(clienteId: string): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const cat of this.categoriasDocs) {
      const files = this.arquivosMap[cat.key] ?? [];
      if (files.length) {
        result[cat.key] = await this.uploadArquivosGrupo(clienteId, cat.key, files);
      }
    }

    if (this.signatureDataUrl) {
      const blob = this.dataURLtoBlob(this.signatureDataUrl);
      const path = `clientes/${clienteId}/assinatura/assinatura-${Date.now()}.png`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, blob, { contentType: 'image/png' });
      const url = await getDownloadURL(storageRef);
      result['assinatura'] = [url];
    }

    return result;
  }

  // ================== HELPERS PARA FIRESTORE ==================
  private pruneUndefinedDeep<T>(obj: T): T {
    if (Array.isArray(obj)) {
      return obj.map((v) => this.pruneUndefinedDeep(v)).filter((v) => v !== undefined) as any;
    }
    if (obj !== null && typeof obj === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(obj as any)) {
        if (v === undefined) continue;
        out[k] = this.pruneUndefinedDeep(v as any);
      }
      return out;
    }
    return obj;
  }

  private coerceCliente(c: Cliente) {
    return {
      ...c,
      rendaMensal: c.rendaMensal ?? '',
      valorSolicitado: c.valorSolicitado ?? '',
      valorParcela: c.valorParcela ?? '',
      parcelas: c.parcelas == null ? null : Number(c.parcelas),
      fluxoCaixa: c.fluxoCaixa ?? null,
      fluxoCaixaTotais: c.fluxoCaixaTotais ?? { receita: 0, custos: 0, lucro: 0 },
    };
  }

  // ================== SALVAR (com anexos, assinatura e STATUS) ==================
  async salvar() {
    this.atualizarDataNascimento();

    const cpfLimpo = (this.cliente.cpf ?? '').replace(/\D/g, '');

    if (!this.validarCPF(cpfLimpo)) {
      alert('⚠️ CPF inválido. Corrija antes de salvar.');
      return;
    }

    const e164 = this.toE164BR(this.cliente?.contato);
    if (!e164) {
      alert('⚠️ Informe um CELULAR com DDD válido (ex.: 91 9XXXX-XXXX).');
      return;
    }

    if (this.cliente.dataNascimento) {
      const [a, m, d] = this.cliente.dataNascimento.split('-').map(v => parseInt(v, 10));
      if (!this.isDataValida(a, m, d)) {
        alert('⚠️ Data de nascimento inválida.');
        return;
      }
    }

    // ======= Normalizações =======
    const rendaMensal = this.converterMoedaParaNumero(this.cliente.rendaMensal);
    const valorSolicitado = this.converterMoedaParaNumero(this.cliente.valorSolicitado);
    const valorParcela = this.converterMoedaParaNumero(this.cliente.valorParcela);

    const cpfFormatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

    const telDigits = String(this.cliente?.contato ?? '').replace(/\D/g, '').slice(-11);
    const contatoFormatado = telDigits.length === 11
      ? telDigits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
      : this.cliente?.contato ?? '';

    const valorSolicitadoFormatado = this.formatBRN(valorSolicitado);

    const nomeIndex = (this.cliente?.nomeCompleto || '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    try {
      this.uploadStatus = { ok: false, msg: 'Enviando anexos (otimizados)...' };
      const anexosUrls = await this.uploadTodosArquivos(cpfLimpo);

      this.uploadStatus = { ok: false, msg: 'Gravando cadastro...' };

      // ---------- Status inicial + histórico ----------
      const statusInicial: StatusEvent = {
        at: new Date(),
        byUid: 'system',          // se quiser trocar pelo assessor no futuro, mantenha este como histórico “sistema”
        byNome: 'Assessor',
        from: undefined,
        to: 'em_analise',
        note: 'Cadastro criado e enviado para análise.',
      };

      // >>>>>> Quem criou (Auth)
      const u = this.auth.currentUser;
      const createdByUid = u?.uid || null;
      const createdByNome = u?.displayName || u?.email || 'Usuário';
      const createdByEmail = u?.email || null;

      // Coagir tipos e remover undefined
      const coerced = this.coerceCliente(this.cliente);
      const payload: any = this.pruneUndefinedDeep({
        ...coerced,
        cpf: cpfLimpo,
        rendaMensal,
        valorSolicitado,
        valorParcela,
        cpfFormatado,
        contatoFormatado,
        valorSolicitadoFormatado,
        nomeIndex,
        anexos: anexosUrls,

        // >>>>>>> campos de status <<<<<<<<
        status: 'em_analise' as StatusCadastro,
        statusHistory: [statusInicial],

        // >>>>>>> autoria <<<<<<<<
        createdByUid,
        createdByNome,
        createdByEmail,
        createdAt: serverTimestamp(),   // melhor para ordenação no backend

        // espelhos úteis
        _thumbUrl: (anexosUrls['fotoPessoa']?.[0] ?? null),
        _assinaturaUrl: (anexosUrls['assinatura']?.[0] ?? null),

      });

      // >>>>>>> AQUI grava no Firestore <<<<<<<<
      await setDoc(doc(db, 'clientes', cpfLimpo), payload, { merge: true });

      this.uploadStatus = { ok: true, msg: 'Cadastro salvo com anexos e assinatura!' };

      // fire-and-forget
      this.enviarEmailBemVindo();
      this.abrirWhatsAppE164(e164, this.cliente?.nomeCompleto);

      alert('✅ Cliente salvo com sucesso!');
      this.limparFormularioCadastro();

    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      this.uploadStatus = { ok: false, msg: '❌ Falha ao salvar anexos/assinatura.' };
      alert('❌ Falha ao salvar cliente.');
    }
  }

  // ---------- Modal Fluxo de Caixa ----------
  openFluxoModal() {
    if (this.cliente.fluxoCaixa) {
      const f = this.cliente.fluxoCaixa;
      this.faturamento = f.faturamentoMensal || 0;
      this.faturamentoInput = this.faturamento ? String(Math.trunc(this.faturamento)) : '';
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
      this.fluxoForm.variaveis.outros = (f.variaveis.outros || []).map(o => ({
        nome: o.nome, valor: o.valor || 0, valorMasked: this.formatBRN(o.valor || 0)
      }));

    } else {
      this.faturamentoInput = this.faturamento ? String(Math.trunc(this.faturamento)) : '';
      this.fluxoForm.fixos = {
        aluguelMasked: '', salariosMasked: '', energiaEletricaMasked: '', aguaMasked: '', telefoneInternetMasked: '',
        aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0
      };
      this.fluxoForm.variaveis = {
        materiaPrimaMasked: '', insumosMasked: '', freteMasked: '', transporteMasked: '',
        materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: []
      };
      this.fluxoForm.faturamentoMensal = this.faturamento;
    }

    this.recalcular();

    const el = document.getElementById('fluxoCaixaModal');
    if (el) {
      this.fluxoModalRef = new bootstrap.Modal(el, { backdrop: 'static' });
      this.fluxoModalRef.show();
    }
  }

  // --------- Faturamento ---------
  faturamento: number = 0;
  faturamentoInput: string = '';

  parseMoneyBR(masked: any): number {
    if (masked === null || masked === undefined) return 0;
    let s = String(masked).trim();
    if (!s) return 0;
    s = s.replace(/[^\d.,-]/g, '');
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    } else {
      s = s.replace(/\./g, '');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    }
  }

  onFaturamentoChange(digits: string) {
    const n = Number(digits || 0);
    this.faturamento = n;
    this.fluxoForm.faturamentoMensal = n;
    this.cliente.faturamentoMensal = this.formatBRN(n);
  }

  closeFluxoModal() {
    if (this.fluxoModalRef) {
      this.fluxoModalRef.hide();
      this.fluxoModalRef = null;
    }
  }

  onFaturamentoInput(view: string) {
    const num = this.parseBRN(view);
    this.fluxoForm.faturamentoMensal = num;
    this.fluxoForm.faturamentoMensalView = view;
  }

  onFaturamentoBlur() {
    this.fluxoForm.faturamentoMensalView = this.formatBRN(this.fluxoForm.faturamentoMensal || 0);
  }

  addOutro() {
    this.fluxoForm.variaveis.outros.push({ nome: '', valorMasked: '', valor: 0 });
  }
  removeOutro(i: number) {
    this.fluxoForm.variaveis.outros.splice(i, 1);
  }

  syncOutroValor(i: number, masked: string) {
    const val = this.parseBRN(masked);
    this.fluxoForm.variaveis.outros[i].valor = val;
  }

  syncNumber(path: string, masked: string) {
    const n = this.parseBRN(masked);
    const set = (obj: any, p: string[], value: number): void => {
      if (p.length === 1) { obj[p[0]] = value; return; }
      set(obj[p[0]], p.slice(1), value);
    };
    set(this.fluxoForm, path.split('.'), n);
  }

  totalReceita(): number {
    return this.fluxoForm.faturamentoMensal || 0;
  }
  totalCustos(): number {
    const f = this.fluxoForm.fixos;
    const v = this.fluxoForm.variaveis;
    const somaFixos =
      (f.aluguel || 0) + (f.salarios || 0) + (f.energiaEletrica || 0) + (f.agua || 0) + (f.telefoneInternet || 0);
    const somaVariaveis =
      (v.materiaPrima || 0) + (v.insumos || 0) + (v.frete || 0) + (v.transporte || 0) +
      (v.outros || []).reduce((acc: number, o) => acc + (o.valor || 0), 0);
    return somaFixos + somaVariaveis;
  }
  totalLucro(): number {
    return this.totalReceita() - this.totalCustos();
  }
  saveFluxo() {
    const fluxo: FluxoCaixa = {
      faturamentoMensal: this.faturamento || 0,
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
        outros: (this.fluxoForm.variaveis.outros || []).map(o => ({ nome: o.nome || 'Outro', valor: o.valor || 0 })),
      },
    };

    this.cliente.fluxoCaixa = fluxo;
    this.recalcular();
    this.cliente.faturamentoMensal = this.formatBRN(this.faturamento);
    this.closeFluxoModal();
  }

  addOutroResumo() {
    if (!this.cliente.fluxoCaixa) return;
    this.cliente.fluxoCaixa.variaveis.outros.push({ nome: '', valor: 0 });
    this.recalcular();
  }
  removeOutroResumo(i: number) {
    if (!this.cliente.fluxoCaixa) return;
    this.cliente.fluxoCaixa.variaveis.outros.splice(i, 1);
    this.recalcular();
  }

  // ====== Parcela Sugerida ======
  private approxEqual(a: number, b: number, eps = 0.01): boolean {
    return Math.abs(a - b) <= eps;
  }

  private getOutrasRendasNumber(): number {
    const v = this.converterMoedaParaNumero(this.cliente?.rendaMensal);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  computeParcelaSugerida() {
    const lucro = this.cliente?.fluxoCaixaTotais?.lucro || 0;
    const outras = this.getOutrasRendasNumber();
    const base = lucro > 0 ? (lucro + outras) : outras;
    if (base <= 0) return { valor: 0, fator: 0.30, base: 0 };
    const valor = base * 0.30;
    return { valor, fator: 0.30, base };
  }

  getParcelaSugeridaTexto(): string {
    const { valor } = this.computeParcelaSugerida();
    if (valor <= 0) return 'Parcela sugerida: —';
    return `Parcela sugerida: ${this.formatBRL(valor)}`;
  }

  // ===== Utilitários de moeda BR =====
  parseBRN(masked: string | null | undefined): number {
    if (!masked) return 0;
    let s = String(masked).replace(/[^\d,]/g, "");
    const partes = s.split(",");
    if (partes.length > 1) {
      const decimais = partes.pop();
      s = partes.join("") + "." + decimais;
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  formatBRN(n: number): string {
    try {
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch {
      return `R$ ${(+n || 0).toFixed(2)}`;
    }
  }

  recalcular() {
    if (!this.cliente.fluxoCaixa) {
      this.cliente.fluxoCaixaTotais = { receita: 0, custos: 0, lucro: 0 };
      return;
    }
    const f = this.cliente.fluxoCaixa;

    const receita = +(f.faturamentoMensal || 0);
    const custosFixos =
      +(f.fixos.aluguel || 0) +
      +(f.fixos.salarios || 0) +
      +(f.fixos.energiaEletrica || 0) +
      +(f.fixos.agua || 0) +
      +(f.fixos.telefoneInternet || 0);

    const custosVar =
      +(f.variaveis.materiaPrima || 0) +
      +(f.variaveis.insumos || 0) +
      +(f.variaveis.frete || 0) +
      +(f.variaveis.transporte || 0) +
      (f.variaveis.outros || []).reduce((acc: number, o) => acc + +(o.valor || 0), 0);

    const custos = custosFixos + custosVar;
    const lucro = receita - custos;

    this.cliente.fluxoCaixaTotais = { receita, custos, lucro };
  }

  getParcelaEscolhidaNumber(): number {
    const n = Number(this.cliente?.parcelas || 0);
    if (!n || !this.valorSolicitadoNumber) return 0;
    return this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
  }

  isParcelaAcimaSugerida(): boolean {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    const eps = 0.01;
    if (!escolhida || !sugerida) return false;
    return escolhida > sugerida + eps;
  }

  getComparacaoParcelaTexto(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return '';
    const diff = escolhida - sugerida;
    const limite10 = sugerida * 1.10;
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
    if (escolhida <= sugerida * 1.10) return 'text-dark';
    return 'text-dark';
  }

  getParcelaEscolhidaClasse(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return 'bg-secondary-subtle text-dark border';
    if (escolhida <= sugerida) return 'bg-success-subtle text-dark border';
    if (escolhida <= sugerida * 1.10) return 'bg-warning-subtle text-dark border';
    return 'bg-danger-subtle text-dark border';
  }

  // ---- Nacionalidade ----
  nacionalidadeBase: string = '';
  listaPaises: string[] = [/* ... (mesma lista) ... */"Zimbábue"];

  private syncNacionalidadeBaseFromCliente() {
    const val = this.cliente?.nacionalidade || '';
    if (!val) { this.nacionalidadeBase = ''; return; }
    if (val === 'Brasileiro Nato' || val === 'Brasileiro Naturalizado' || val === 'Prefere não declarar') {
      this.nacionalidadeBase = val;
    } else if (this.listaPaises.includes(val)) {
      this.nacionalidadeBase = 'Estrangeiro';
    } else {
      this.nacionalidadeBase = '';
    }
  }

  onNacionalidadeBaseChange(base: string) {
    this.nacionalidadeBase = base;
    if (base === 'Brasileiro Nato' || base === 'Brasileiro Naturalizado' || base === 'Prefere não declarar') {
      this.cliente.nacionalidade = base;
    } else if (base === 'Estrangeiro') {
      this.cliente.nacionalidade = '';
    } else {
      this.cliente.nacionalidade = '';
    }
  }

  // ---------- Modal Anexos ----------
  openAnexosModal() {
    const el = document.getElementById('anexosModal');
    if (el) {
      this.anexosModalRef = new bootstrap.Modal(el, { backdrop: 'static' });
      this.anexosModalRef.show();
    }
  }
  closeAnexosModal() {
    if (this.anexosModalRef) {
      this.anexosModalRef.hide();
      this.anexosModalRef = null;
    }
  }
}
