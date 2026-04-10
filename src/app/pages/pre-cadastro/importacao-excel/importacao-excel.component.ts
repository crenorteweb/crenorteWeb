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
import { LinhaImportacao, ResultadoImportacao } from './importacao-excel.model';

declare const bootstrap: any;

type Etapa = 'upload' | 'preview' | 'importando' | 'concluido';

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

  etapa = signal<Etapa>('upload');
  arquivo = signal<File | null>(null);
  linhas = signal<LinhaImportacao[]>([]);
  progresso = signal({ atual: 0, total: 0 });
  resultado = signal<ResultadoImportacao | null>(null);
  erro = signal<string | null>(null);
  isDragOver = signal(false);
  processando = signal(false);
  mostrarDetalhesErros = signal(false);

  linhasValidas    = computed(() => this.linhas().filter((l) => l.valida));
  linhasInvalidas  = computed(() => this.linhas().filter((l) => !l.valida && !l.duplicadaNaPlanilha));
  linhasDuplicadas = computed(() => this.linhas().filter((l) => !!l.duplicadaNaPlanilha));
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

  /** Chamado pelo componente pai via @ViewChild */
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
    this.progresso.set({ atual: 0, total: 0 });
    this.resultado.set(null);
    this.erro.set(null);
    this.isDragOver.set(false);
    this.processando.set(false);
    this.mostrarDetalhesErros.set(false);
  }

  // ===== Upload / Drag-and-drop =====

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.arquivo.set(file);
    input.value = ''; // permite reselecionar o mesmo arquivo
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

  // ===== Etapa 1 → 2: Processar planilha =====

  async processarArquivo(): Promise<void> {
    const file = this.arquivo();
    if (!file) return;

    this.processando.set(true);
    this.erro.set(null);

    try {
      let linhas = await this.svc.parseExcel(file);
      if (linhas.length === 0) {
        this.erro.set('Nenhuma linha de dados encontrada na planilha. Verifique se o arquivo segue o modelo.');
        return;
      }
      linhas = this.svc.validarFormatos(linhas);
      linhas = await this.svc.verificarCpfsDuplicados(linhas);
      this.linhas.set(linhas);
      this.etapa.set('preview');
    } catch (e: any) {
      this.erro.set(e?.message || 'Erro ao processar o arquivo. Verifique se ele segue o modelo correto.');
    } finally {
      this.processando.set(false);
    }
  }

  // ===== Etapa 2 → 3: Confirmar importação =====

  async confirmarImportacao(): Promise<void> {
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

  voltarParaUpload(): void {
    this.reiniciar();
  }

  downloadCadastrados(): void {
    const res = this.resultado();
    if (res?.linhasImportadas?.length) {
      this.svc.exportarCadastrados(res.linhasImportadas);
    }
  }
}
