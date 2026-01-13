import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TriagemPreCadastrosComponent } from './triagem-pre-cadastros.component';

describe('TriagemPreCadastrosComponent', () => {
  let component: TriagemPreCadastrosComponent;
  let fixture: ComponentFixture<TriagemPreCadastrosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TriagemPreCadastrosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TriagemPreCadastrosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
