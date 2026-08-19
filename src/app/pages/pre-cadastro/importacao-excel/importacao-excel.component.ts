import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  computed,
  Output,
  EventEmitter,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportacaoExcelService } from './importacao-excel.service';
import {
  LinhaImportacao, ResultadoImportacao,
  LinhaElegibilidade, ResultadoElegibilidade,
} from './importacao-excel.model';

declare const bootstrap: any;

type Etapa = 'upload' | 'preview' | 'importando' | 'concluido';
type Tipo  = 'cadastro' | 'elegibilidade';

@Component({
  selector: 'app-importacao-excel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './importacao-excel.component.html',
  styleUrls: ['./importacao-excel.component.css'],
})
export class ImportacaoExcelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('importacaoModalEl') modalEl?: ElementRef<HTMLDivElement>;
  @Output() importacaoConcluida = new EventEmitter<void>();

  private svc = inject(ImportacaoExcelService);
  private bsModal?: any;

  // ===== Estado compartilhado =====
  tipo     = signal<Tipo>('cadastro');
  etapa    = signal<Etapa>('upload');
  arquivo  = signal<File | null>(null);
  progresso = signal({ atual: 0, total: 0 });
  erro      = signal<string | null>(null);
  isDragOver   = signal(false);
  processando  = signal(false);
  mostrarDetalhesErros = signal(false);

  // ===== Estado: modo CADASTRO =====
  linhas    = signal<LinhaImportacao[]>([]);
  resultado = signal<ResultadoImportacao | null>(null);

  linhasValidas    = computed(() => this.linhas().filter((l) => l.valida));
  linhasInvalidas  = computed(() => this.linhas().filter((l) => !l.valida && !l.duplicadaNaPlanilha));
  linhasDuplicadas = computed(() => this.linhas().filter((l) => !!l.duplicadaNaPlanilha));

  // ===== Estado: modo ELEGIBILIDADE =====
  linhasEleg    = signal<LinhaElegibilidade[]>([]);
  resultadoEleg = signal<ResultadoElegibilidade | null>(null);

  linhasElegValidas   = computed(() => this.linhasEleg().filter(l => l.valida));
  linhasElegInvalidas = computed(() => this.linhasEleg().filter(l => !l.valida && !l.duplicadaNaPlanilha));
  linhasElegDuplic    = computed(() => this.linhasEleg().filter(l => !!l.duplicadaNaPlanilha));

  // ===== Progresso =====
  progressoPct = computed(() => {
    const p = this.progresso();
    return p.total > 0 ? Math.round((p.atual / p.total) * 100) : 0;
  });

  ngAfterViewInit(): void {
    if (this.modalEl?.nativeElement) {
      this.bsModal = new bootstrap.Modal(this.modalEl.nativeElement, {
        backdrop: 'static',
        keyboard: false,
      });
    }
  }

  ngOnDestroy(): void {
    this.bsModal?.dispose();
  }

  abrirModal(): void {
    this.reiniciar();
    this.bsModal?.show();
  }

  fecharModal(): void {
    this.bsModal?.hide();
  }

  reiniciar(): void {
    this.etapa.set('upload');
    this.arquivo.set(null);
    this.linhas.set([]);
    this.linhasEleg.set([]);
    this.progresso.set({ atual: 0, total: 0 });
    this.resultado.set(null);
    this.resultadoEleg.set(null);
    this.erro.set(null);
    this.isDragOver.set(false);
    this.processando.set(false);
    this.mostrarDetalhesErros.set(false);
  }

  mudarTipo(t: Tipo): void {
    this.tipo.set(t);
    this.reiniciar();
  }

  // ===== Upload / Drag-and-drop =====

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.arquivo.set(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      this.arquivo.set(file);
    } else if (file) {
      this.erro.set('Formato inválido. Envie um arquivo .xlsx ou .xls.');
    }
  }

  removerArquivo(): void {
    this.arquivo.set(null);
    this.erro.set(null);
  }

  downloadTemplate(): void {
    this.svc.downloadTemplate();
  }

  downloadTemplateElegibilidade(): void {
    this.svc.downloadTemplateElegibilidade();
  }

  // ===== Etapa 1 → 2: Processar planilha =====

  async processarArquivo(): Promise<void> {
    const file = this.arquivo();
    if (!file) return;

    this.processando.set(true);
    this.erro.set(null);

    try {
      if (this.tipo() === 'elegibilidade') {
        await this.processarElegibilidade(file);
      } else {
        await this.processarCadastro(file);
      }
    } catch (e: any) {
      this.erro.set(e?.message || 'Erro ao processar o arquivo. Verifique se ele segue o modelo correto.');
    } finally {
      this.processando.set(false);
    }
  }

  private async processarCadastro(file: File): Promise<void> {
    let linhas = await this.svc.parseExcel(file);
    if (linhas.length === 0) {
      this.erro.set('Nenhuma linha de dados encontrada na planilha.');
      return;
    }
    linhas = this.svc.validarFormatos(linhas);
    linhas = await this.svc.verificarCpfsDuplicados(linhas);
    this.linhas.set(linhas);
    this.etapa.set('preview');
  }

  private async processarElegibilidade(file: File): Promise<void> {
    let linhas = await this.svc.parseExcelElegibilidade(file);
    if (linhas.length === 0) {
      this.erro.set('Nenhuma linha de dados encontrada na planilha.');
      return;
    }
    linhas = this.svc.validarFormatosElegibilidade(linhas);

    // Deduplica na planilha (mantém primeira ocorrência)
    const vistos = new Map<string, number>();
    linhas = linhas.map(l => {
      if (!l.valida || l.cpfNumeros.length !== 11) return l;
      if (vistos.has(l.cpfNumeros)) return { ...l, duplicadaNaPlanilha: true, valida: false };
      vistos.set(l.cpfNumeros, l.index);
      return l;
    });

    this.linhasEleg.set(linhas);
    this.etapa.set('preview');
  }

  // ===== Etapa 2 → 3: Confirmar =====

  async confirmarImportacao(): Promise<void> {
    if (this.tipo() === 'elegibilidade') {
      await this.confirmarElegibilidade();
    } else {
      await this.confirmarCadastro();
    }
  }

  private async confirmarCadastro(): Promise<void> {
    if (this.linhasValidas().length === 0) return;

    this.etapa.set('importando');
    this.progresso.set({ atual: 0, total: this.linhasValidas().length });

    try {
      const resultado = await this.svc.importar(this.linhas(), (atual, total) => {
        this.progresso.set({ atual, total });
      });
      this.resultado.set(resultado);
      this.etapa.set('concluido');
      this.importacaoConcluida.emit();
    } catch (e: any) {
      this.erro.set(e?.message || 'Erro durante a importação. Tente novamente.');
      this.etapa.set('preview');
    }
  }

  private async confirmarElegibilidade(): Promise<void> {
    if (this.linhasElegValidas().length === 0) return;

    this.etapa.set('importando');
    this.progresso.set({ atual: 0, total: this.linhasElegValidas().length });

    try {
      const resultado = await this.svc.atualizarElegibilidade(this.linhasEleg(), (atual, total) => {
        this.progresso.set({ atual, total });
      });
      this.resultadoEleg.set(resultado);
      this.etapa.set('concluido');
      this.importacaoConcluida.emit();
    } catch (e: any) {
      this.erro.set(e?.message || 'Erro durante a atualização. Tente novamente.');
      this.etapa.set('preview');
    }
  }

  voltarParaUpload(): void {
    this.reiniciar();
  }

  downloadCadastrados(): void {
    const res = this.resultado();
    if (res?.linhasImportadas?.length) {
      this.svc.exportarCadastrados(res.linhasImportadas);
    }
  }

  // ===== Helpers template =====
  totalLinhasParaConfirmar(): number {
    return this.tipo() === 'elegibilidade'
      ? this.linhasElegValidas().length
      : this.linhasValidas().length;
  }
}
