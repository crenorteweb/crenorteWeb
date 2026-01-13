import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PreCadastroFormComponent } from './pre-cadastro-form.component';

describe('PreCadastroFormComponent', () => {
  let component: PreCadastroFormComponent;
  let fixture: ComponentFixture<PreCadastroFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreCadastroFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PreCadastroFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
