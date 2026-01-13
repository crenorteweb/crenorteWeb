import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AprovacaoPreCadastroComponent } from './aprovacao-pre-cadastro.component';

describe('AprovacaoPreCadastroComponent', () => {
  let component: AprovacaoPreCadastroComponent;
  let fixture: ComponentFixture<AprovacaoPreCadastroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AprovacaoPreCadastroComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AprovacaoPreCadastroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
